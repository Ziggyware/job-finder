import { jobsById } from '../data/jobs';
import type {
  Application,
  ApplicationStep,
  Job,
  JobMatch,
  LogEntry,
  PendingTask,
  ResumeProfile,
  StepStatus,
} from '../types';
import type { LocalAI } from '../ai/engine';
import { answerQuestion, draftCoverLetter, refineMatch } from '../ai/tasks';
import { answerMatches, makePendingChallenge, nextChallenge, solveChallengeWithAI } from '../ai/humanCheck';
import { newId, useStore, type Criteria } from '../store';
import { formFieldsFor, scoreJob, type FormField } from '../lib/match';
import { confirmationId, sleep } from '../lib/util';

// ---------------------------------------------------------------------------
// The pilot.
//
// A deterministic state machine that walks one application at a time and
// narrates itself into the activity log. Two things it must stop for — sensitive
// questions and visual anti-bot walls — are first-class states, not error paths.
// Nothing here pretends: when the local model cannot do something, the operator
// is asked, and the log says so out loud.
//
// Lifecycle rules (these are what keep stop → start from running two loops):
//   • Each run owns a loop promise. A new run waits for the previous loop to
//     unwind before it resets any flags, so the old loop can never see the new
//     run's state.
//   • Stop settles every waiter, clears their timers, and clears pending items.
//   • Every application and step leaves the run in a terminal state.
// ---------------------------------------------------------------------------

/** Thrown to unwind one application without killing the whole run. */
class SkipApplication extends Error {}
/** Thrown when the operator hits stop. */
class RunStopped extends Error {}

interface HumanReply {
  value: string;
  decision: 'answer' | 'skip' | 'timeout';
}

interface Waiter {
  resolve: (v: HumanReply) => void;
  timer?: ReturnType<typeof setTimeout>;
}

const errText = (e: unknown) => (e as Error)?.message ?? String(e);

export class Pilot {
  private paused = false;
  private stopped = false;
  private waiters = new Map<string, Waiter>();
  private running = false;
  /** Identifies the run that currently owns the pilot. */
  private token: object | null = null;
  /** The loop promise of the current (or most recent) run. */
  private loop: Promise<void> | null = null;
  private ai: LocalAI | null = null;
  /** 1 = watchable, 4 = hurry up. */
  speed = 1;

  get isPaused() {
    return this.paused;
  }
  get isRunning() {
    return this.running;
  }

  private get st() {
    return useStore.getState();
  }

  private log(level: LogEntry['level'], text: string, appId?: string) {
    this.st.log(level, text, appId);
  }

  private async wait(ms: number) {
    await this.checkpoint();
    await sleep(ms / this.speed);
  }

  /** Hold while paused; unwind if stopped. Called at every step boundary. */
  private async checkpoint() {
    while (this.paused && !this.stopped) await sleep(120);
    if (this.stopped) throw new RunStopped();
  }

  pause() {
    if (!this.running || this.paused || this.stopped) return;
    this.paused = true;
    this.st.setPhase('paused');
    this.log('warn', 'Run paused by operator. The pilot holds at the next checkpoint.');
  }

  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.st.setPhase('running');
    this.log('info', 'Run resumed.');
  }

  stop() {
    if (!this.running) return;
    this.stopped = true;
    this.paused = false;
    this.running = false;
    this.ai?.interrupt();
    // Nothing waits on a human after a stop: settle every waiter, then clear the queue.
    for (const id of [...this.waiters.keys()]) this.settle(id, { value: '', decision: 'skip' });
    for (const p of [...this.st.pending]) this.st.resolvePending(p.id);
    this.st.setPhase('stopped');
    this.st.setActiveAppId(null);
    this.log('warn', 'Run stopped by operator. Applications already submitted stay submitted.');
  }

  // --- human-in-the-loop plumbing -----------------------------------------

  answerPending(taskId: string, value: string) {
    this.settle(taskId, { value, decision: value ? 'answer' : 'skip' });
    this.st.resolvePending(taskId);
  }

  skipPending(taskId: string) {
    this.settle(taskId, { value: '', decision: 'skip' });
    this.st.resolvePending(taskId);
  }

  /** Resolve a waiter exactly once, and cancel its timeout. */
  private settle(taskId: string, reply: HumanReply): boolean {
    const w = this.waiters.get(taskId);
    if (!w) return false;
    this.waiters.delete(taskId);
    if (w.timer !== undefined) clearTimeout(w.timer);
    w.resolve(reply);
    return true;
  }

  private awaitHuman(taskId: string): Promise<HumanReply> {
    return new Promise<HumanReply>((resolve) => {
      const waiter: Waiter = { resolve };
      this.waiters.set(taskId, waiter);
      const timeout = this.st.criteria.humanCheckTimeoutMs;
      if (timeout > 0) {
        waiter.timer = setTimeout(() => {
          if (this.waiters.get(taskId) !== waiter) return;
          this.log(
            'warn',
            'No answer within the wait window — abandoning this application rather than guessing on your behalf. Raise “wait for me” in the Briefing filters if you need longer.',
          );
          this.settle(taskId, { value: '', decision: 'timeout' });
          this.st.resolvePending(taskId);
        }, timeout);
      }
    });
  }

  /**
   * Escalate one question/field to the operator and block until they reply.
   * Throws SkipApplication if they decline or time out.
   */
  private async escalate(
    app: Application,
    step: ApplicationStep,
    prompt: string,
    reason: string,
    extra: Partial<PendingTask> = {},
  ): Promise<string> {
    const task: PendingTask = {
      ...makePendingChallenge(app.id, app.jobId, app.job.title, app.job.company, step.id, {
        kind: 'checkbox',
        solvableBy: 'human',
        prompt,
      }),
      kind: 'question',
      challenge: undefined,
      challengePrompt: undefined,
      question: prompt,
      reason,
      suggestion: undefined,
      ...extra,
    };
    this.st.addPending(task);
    this.st.patchApplication(app.id, { status: 'needs-you' });
    this.st.patchStep(app.id, step.id, {
      status: 'blocked',
      detail: `Waiting on you — ${reason}`,
      questionId: task.id,
    });
    this.log('human', `⏸ Needs you: “${prompt}” (${app.job.company}). ${reason}`, app.id);

    const reply = await this.awaitHuman(task.id);
    if (reply.decision !== 'answer') {
      this.st.patchStep(app.id, step.id, {
        status: 'skipped',
        detail: reply.decision === 'timeout' ? 'Timed out — not submitted.' : 'Declined by operator.',
      });
      this.st.patchApplication(app.id, {
        status: 'failed',
        error: reply.decision === 'timeout' ? 'Timed out waiting on the operator.' : 'Operator declined to answer.',
      });
      this.log('warn', `No answer for “${prompt}” — the ${app.job.company} application is not being submitted.`, app.id);
      throw new SkipApplication();
    }
    this.st.patchStep(app.id, step.id, {
      status: 'done',
      finishedAt: Date.now(),
      answer: reply.value,
      detail: `Your answer: “${reply.value}”`,
    });
    this.st.patchApplication(app.id, { status: 'filling' });
    return reply.value;
  }

  // --- main loop -----------------------------------------------------------

  /**
   * Start a run. If one is already live this is a no-op that returns that run's
   * promise. If a previous run is still unwinding after a stop, this waits for it
   * to finish first, so two loops never work the same queue.
   */
  run(ai: LocalAI | null, matches: JobMatch[], criteria: Criteria, profile: ResumeProfile): Promise<void> {
    if (this.running) return this.loop ?? Promise.resolve();

    const prior = this.loop;
    const token = {};
    this.token = token;
    this.running = true;

    this.loop = (async () => {
      if (prior) await prior.catch(() => undefined);
      // Only now is the previous loop guaranteed to be gone: reset this run's flags.
      this.paused = false;
      this.stopped = false;
      this.ai = ai;
      this.st.resetRun();
      this.st.setPhase('running');
      this.st.setActiveAppId(null);
      try {
        await this.body(ai, matches, criteria, profile);
      } finally {
        // Only the run that still owns the pilot may change its status.
        if (this.token === token) {
          this.running = false;
          const phase = this.st.phase;
          if (phase === 'running' || phase === 'paused') this.st.setPhase('finished');
          this.st.setActiveAppId(null);
        }
      }
    })();
    return this.loop;
  }

  private async body(ai: LocalAI | null, matches: JobMatch[], criteria: Criteria, profile: ResumeProfile) {
    const st = this.st;
    const queue = matches
      .filter((m) => m.score >= criteria.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, criteria.maxApplications);

    try {
      st.log('info', `Briefing accepted for ${profile.name}. ${queue.length} postings in the run order.`);
      if (ai?.ready) {
        st.log(
          'ai',
          `Local model online: ${st.engine.modelId}${st.engine.tokensPerSec ? ` · ~${st.engine.tokensPerSec} tok/s` : ''} · ${st.backendLabel}. Inference happens inside this tab — no API key, no request to any AI service, no per-token cost.`,
        );
      } else {
        st.log(
          'warn',
          'No local model loaded. Running in heuristic mode: matching, field-filling and submission still work off your resume; wording is template-based.',
        );
      }
      if (!criteria.autoSubmit) {
        st.log('warn', 'Auto-submit is OFF — the pilot parks at the final review of each application and waits for you.');
      }
      if (!queue.length) {
        st.log('warn', 'Nothing in the queue met your minimum score. Lower the threshold in Settings and re-run.');
      }

      for (let i = 0; i < queue.length; i++) {
        if (this.stopped) break;
        const job = jobsById.get(queue[i].jobId);
        if (!job) {
          this.log('warn', `Skipping posting ${queue[i].jobId}: it is no longer in the job list.`);
          continue;
        }
        st.log('info', `── ${i + 1}/${queue.length} · ${job.title} @ ${job.company} ──`);
        try {
          await this.runOne(ai, profile, job, queue[i], criteria, i);
        } catch (e) {
          if (e instanceof RunStopped) break;
          if (e instanceof SkipApplication) {
            this.log('info', `Moving on. The ${job.company} application was left unsent on purpose.`);
          } else {
            // runOne has already closed the application out as failed; this only reports it.
            this.log('warn', `Application to ${job.company} failed: ${errText(e)}`);
          }
        }
        this.st.setActiveAppId(null);
        try {
          await this.wait(420);
        } catch (e) {
          if (e instanceof RunStopped) break;
          throw e;
        }
      }
    } catch (e) {
      if (!(e instanceof RunStopped)) this.log('warn', `Pilot halted: ${errText(e)}`);
    }
    this.summarise();
  }

  private summarise() {
    const s = this.st;
    const submitted = s.applications.filter((a) => a.status === 'submitted').length;
    const parked = s.applications.filter((a) => a.status === 'needs-you').length;
    const failed = s.applications.filter((a) => a.status === 'failed').length;
    if (this.stopped) {
      // An operator stop is not a completion. Say what actually got sent.
      s.log('warn', `Run stopped by operator — ${submitted} application(s) were already submitted and stay submitted.`);
      s.setPhase('stopped');
    } else {
      s.log(
        'good',
        `Run complete — ${submitted} submitted · ${parked} waiting on you · ${failed} not sent. Full audit trail is in the log above.`,
      );
      s.setPhase('finished');
    }
    s.setActiveAppId(null);
  }

  /**
   * Close out an application whatever happened: every open step gets a terminal
   * status, and the application itself ends submitted or failed. Stop and skip
   * leave steps 'skipped'; an unexpected error leaves them 'failed'.
   */
  private closeOut(appId: string, outcome: unknown) {
    const app = this.st.applications.find((a) => a.id === appId);
    if (!app) return;
    const stopped = outcome instanceof RunStopped;
    const skipped = outcome instanceof SkipApplication;
    const unexpected = outcome !== null && !stopped && !skipped;

    for (const s of app.steps) {
      if (s.status === 'pending' || s.status === 'running' || s.status === 'blocked') {
        this.st.patchStep(appId, s.id, {
          status: unexpected ? 'failed' : 'skipped',
          detail: unexpected
            ? 'Stopped by an unexpected error.'
            : stopped
              ? 'Run stopped before this step.'
              : 'Application closed before this step.',
        });
      }
    }

    if (app.status !== 'submitted' && app.status !== 'failed') {
      const error = unexpected
        ? `Unexpected error: ${errText(outcome)}`
        : stopped
          ? 'Stopped by operator before submission.'
          : 'Ended before submission.';
      this.st.patchApplication(appId, { status: 'failed', error });
    }
  }

  // --- one application -----------------------------------------------------

  private async runOne(
    ai: LocalAI | null,
    profile: ResumeProfile,
    job: Job,
    match: JobMatch,
    criteria: Criteria,
    index: number,
  ) {
    const st = this.st;
    const fields = formFieldsFor(job);
    const appId = newId('app');

    const steps: ApplicationStep[] = [];
    const mk = (kind: ApplicationStep['kind'], label: string, extra: Partial<ApplicationStep> = {}) => {
      const step: ApplicationStep = { id: newId('st'), kind, status: 'pending', label, ...extra };
      steps.push(step);
      return step;
    };

    const navStep = mk('navigate', `${job.company} careers portal — open posting`);
    const analyzeStep = mk('analyze', 'Parse requirements the way the ATS does');
    const matchStep = mk('match', 'Score the fit against your resume');
    const fieldSteps = fields.map((f) => mk('field', `Fill: ${f.label}`, { questionId: f.id }));
    const checkStep = mk('human-check', 'Portal anti-bot checkpoint');
    const submitStep = mk('submit', 'Click submit');
    const confirmStep = mk('confirmed', 'Confirmation & receipt');

    const app: Application = {
      id: appId,
      jobId: job.id,
      job,
      status: 'queued',
      score: match.score,
      match,
      steps,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    st.addApplication(app);
    st.setActiveAppId(appId);

    let outcome: unknown = null;
    try {
      await this.pursue(ai, profile, job, match, criteria, index, app, {
        navStep,
        analyzeStep,
        matchStep,
        fields,
        fieldSteps,
        checkStep,
        submitStep,
        confirmStep,
      });
    } catch (e) {
      outcome = e;
    } finally {
      this.closeOut(appId, outcome);
    }
    if (outcome) throw outcome;
  }

  private async pursue(
    ai: LocalAI | null,
    profile: ResumeProfile,
    job: Job,
    match: JobMatch,
    criteria: Criteria,
    index: number,
    app: Application,
    s: {
      navStep: ApplicationStep;
      analyzeStep: ApplicationStep;
      matchStep: ApplicationStep;
      fields: FormField[];
      fieldSteps: ApplicationStep[];
      checkStep: ApplicationStep;
      submitStep: ApplicationStep;
      confirmStep: ApplicationStep;
    },
  ) {
    const appId = app.id;
    const { navStep, analyzeStep, matchStep, fields, fieldSteps, checkStep, submitStep, confirmStep } = s;

    const patch = (p: Partial<Application>) => this.st.patchApplication(appId, p);
    const patchStep = (id: string, p: Partial<ApplicationStep>) => this.st.patchStep(appId, id, p);

    /** Wrap each step so the rail always reflects the true state. */
    const run = async (step: ApplicationStep, fn: () => Promise<unknown>, done?: string) => {
      await this.checkpoint();
      patchStep(step.id, { status: 'running', startedAt: Date.now() });
      patch({ status: 'filling' });
      const out = await fn();
      patchStep(step.id, { status: 'done', finishedAt: Date.now(), ...(done ? { detail: done } : {}) });
      return out;
    };

    // 1 — navigate ---------------------------------------------------------
    await run(navStep, async () => {
      this.log('info', `Opening the ${job.company} posting for “${job.title}” (${job.location}, ${job.remote}).`, appId);
      await this.wait(620 + Math.random() * 300);
      this.log(
        'info',
        `${job.applicantCount} applicants so far · posted ${job.postedDaysAgo}d ago · ${job.employment} · ${job.salary}.`,
        appId,
      );
      await this.wait(420);
    });
    patchStep(navStep.id, { detail: `${job.company} · ${job.location}` });

    // 2 — analyze ----------------------------------------------------------
    await run(analyzeStep, async () => {
      if (ai?.ready) {
        try {
          await ai.complete(
            [
              {
                role: 'system',
                content:
                  'Extract the hard requirements of this posting as a comma-separated list, maximum 12 words total. No preamble, no bullets.',
              },
              {
                role: 'user',
                content: `Required: ${job.requiredSkills.join(', ')}. Nice to have: ${job.niceToHave.join(', ')}.`,
              },
            ],
            {
              maxTokens: 50,
              temperature: 0.1,
              onToken: (partial) => patchStep(analyzeStep.id, { detail: partial.slice(-200) }),
            },
          );
        } catch (e) {
          // A model failure here is not a reason to drop the application: the posting's own list is authoritative.
          if (e instanceof RunStopped) throw e;
          this.log('warn', `The local model could not summarise the requirements (${errText(e)}). Using the posting's own list.`, appId);
        }
      }
      this.log('ai', `Requirements parsed → required: ${job.requiredSkills.join(', ')}.`, appId);
      if (job.niceToHave.length)
        this.log('info', `Preferred but not required: ${job.niceToHave.join(', ')}.`, appId);
    });
    patchStep(analyzeStep.id, {
      detail: `${job.requiredSkills.length} required · ${job.niceToHave.length} preferred`,
    });

    // 3 — match ------------------------------------------------------------
    let final: JobMatch = match;
    await run(matchStep, async () => {
      if (ai?.ready) {
        this.log('ai', `Running the why-fit analysis locally on ${this.st.engine.modelId}…`, appId);
        final = await refineMatch(ai, profile, job, match);
      }
      const known = scoreJob(profile, job);
      final = {
        ...final,
        matchedSkills: known.matchedSkills,
        missingSkills: final.missingSkills.length ? final.missingSkills : known.missingSkills,
      };
      this.log(final.verdict === 'strong' ? 'good' : 'info', `Fit ${final.score}/100 (${final.verdict}). ${final.rationale}`, appId);
      patch({ score: final.score, match: final });
      patchStep(matchStep.id, { detail: `${final.score}/100 · ${final.verdict}`, confidence: final.score / 100 });
    });

    // Hard gate — never spray a doomed application into a known auto-reject.
    if (final.score < 35) {
      this.log('warn', `Not submitting to ${job.company}: ${final.rationale}`, appId);
      patch({ status: 'failed', error: final.rationale });
      for (const st of [...fieldSteps, checkStep, submitStep, confirmStep]) patchStep(st.id, { status: 'skipped' });
      return;
    }

    // 4 — fields -----------------------------------------------------------
    const filled = new Map<string, string>();
    for (const step of fieldSteps) {
      const field = fields.find((f) => f.id === step.questionId)!;
      await run(step, async () => {
        const value = await this.fillField(ai, profile, job, field, app, step);
        filled.set(field.id, value);
        patchStep(step.id, {
          answer: value,
          detail: value.length > 160 ? `${value.slice(0, 160)}…` : value,
          confidence: field.id === 'cover_letter' ? 0.8 : 0.95,
        });
        this.log('human', `Filled “${field.label}” → ${value.length > 100 ? `${value.slice(0, 100)}…` : value}`, appId);
      });
    }

    // 5 — the posting's own screening question ------------------------------
    const screening = fields.find((f) => f.id.startsWith('screening_'));
    if (screening) {
      const step: ApplicationStep = {
        id: newId('st'),
        kind: 'answer',
        status: 'pending',
        label: `Answer: ${screening.label.length > 58 ? `${screening.label.slice(0, 58)}…` : screening.label}`,
      };
      this.appendStep(app, step);
      await this.handleQuestion(ai, profile, job, app, step, screening.label);
    }

    // 6 — anti-bot checkpoints ---------------------------------------------
    // Not every posting throws the same walls. Index decides how many.
    const rounds = index % 3 === 0 ? 3 : index % 3 === 1 ? 1 : 2;
    for (let round = 0; round < rounds; round++) {
      await this.checkpoint();
      const step =
        round === 0
          ? checkStep
          : this.appendStep(app, {
              id: newId('st'),
              kind: 'human-check',
              status: 'pending',
              label: 'Portal anti-bot checkpoint (re-issued)',
            });
      await this.runCheckpoint(ai, app, job, step, round);
    }

    // 7 — submit -----------------------------------------------------------
    if (!criteria.autoSubmit) {
      const task: PendingTask = {
        ...makePendingChallenge(appId, job.id, job.title, job.company, submitStep.id, {
          kind: 'checkbox',
          solvableBy: 'human',
          prompt: `Final review — submit the application to ${job.company}?`,
        }),
        kind: 'question',
        question: `Submit the ${job.title} application to ${job.company}?`,
        gate: 'submit',
        suggestion: `All ${filled.size} fields are filled from your resume. Approve to send it, skip to leave it unsent.`,
        reason: 'Auto-submit is off, so the trigger is yours to pull.',
      };
      this.st.addPending(task);
      patch({ status: 'needs-you' });
      patchStep(submitStep.id, {
        status: 'blocked',
        detail: 'Awaiting your approval (auto-submit is off)',
        questionId: task.id,
      });
      this.log('human', `Final review for ${job.company} is parked and waiting on you.`, appId);
      const reply = await this.awaitHuman(task.id);
      if (reply.decision !== 'answer') {
        patchStep(submitStep.id, { status: 'skipped', detail: 'Not approved.' });
        patch({ status: 'failed', error: 'Not approved by operator.' });
        patchStep(confirmStep.id, { status: 'skipped' });
        this.log('warn', `You left ${job.company} unsent. Nothing was transmitted.`, appId);
        return;
      }
    }

    await run(
      submitStep,
      async () => {
        this.log('info', `Clicking “Submit application” on the ${job.company} portal…`, appId);
        await this.wait(880 + Math.random() * 500);
      },
      'Submit clicked',
    );

    const receipt = confirmationId(job.company, job.title);
    await run(
      confirmStep,
      async () => {
        await this.wait(420);
      },
      `Receipt ${receipt}`,
    );

    patch({ status: 'submitted', confirmationId: receipt, coverLetter: filled.get('cover_letter') });
    this.log('good', `✅ Submitted to ${job.company} for “${job.title}” — confirmation ${receipt}.`, appId);
  }

  /**
   * One anti-bot wall. Agent-solved walls tick themselves. Language checks go to
   * the local model; a wrong or missing answer is escalated as a plain question
   * whose text never contains the expected answer. Visual walls are handed to the
   * operator as-is, because a text-only model in a tab cannot see them.
   */
  private async runCheckpoint(
    ai: LocalAI | null,
    app: Application,
    job: Job,
    step: ApplicationStep,
    round: number,
  ) {
    const patchStep = (p: Partial<ApplicationStep>) => this.st.patchStep(app.id, step.id, p);
    await this.checkpoint();
    patchStep({ status: 'running', startedAt: Date.now() });
    this.st.patchApplication(app.id, { status: 'filling' });

    const challenge = nextChallenge(app.id, round);

    if (challenge.solvableBy === 'agent') {
      this.log('ai', `Checkpoint: “${challenge.prompt}” — a plain stall. The pilot ticks it itself, no human needed.`, app.id);
      await this.wait(1200);
      patchStep({ status: 'done', finishedAt: Date.now(), detail: 'Solved by the pilot (tick only)' });
      this.log('good', 'Checkbox challenge passed automatically.', app.id);
      return;
    }

    if (challenge.solvableBy === 'ai') {
      if (!ai?.ready) {
        this.log('human', `Checkpoint: “${challenge.prompt}” is a language check, and no model is loaded to answer it.`, app.id);
        await this.escalateCheckpoint(app, step, challenge.prompt, 'No local model loaded, so this check is left for you rather than guessed.');
        return;
      }
      this.log(
        'ai',
        `Checkpoint: “${challenge.prompt}” — a language puzzle, which is exactly what a small language model is good at.`,
        app.id,
      );
      const solved = await solveChallengeWithAI(
        (p) => ai.complete([{ role: 'user', content: p }], { maxTokens: 10, temperature: 0 }),
        challenge,
      );
      await this.wait(700);
      const guess = solved?.answer ?? '';
      if (guess && answerMatches(guess, challenge.answer ?? '')) {
        patchStep({
          status: 'done',
          finishedAt: Date.now(),
          answer: guess,
          confidence: 0.78,
          detail: `Solved by the local model: “${guess}”`,
        });
        this.log('good', `Pilot answered “${guess}” — accepted first try. No human involved.`, app.id);
        return;
      }
      this.log('warn', `Pilot's answer “${guess || '(nothing)'}” was not accepted. Escalating to you.`, app.id);
      await this.escalateCheckpoint(app, step, challenge.prompt, "The local model's answer was not accepted, so this check is yours.");
      return;
    }

    // Visual wall: honest hand-off. We cannot see images from a text model in a tab.
    const pending = makePendingChallenge(app.id, job.id, job.title, job.company, step.id, challenge);
    this.st.addPending(pending);
    this.st.patchApplication(app.id, { status: 'needs-you' });
    patchStep({ status: 'blocked', detail: challenge.prompt, questionId: pending.id });
    const shape =
      challenge.kind === 'text-image'
        ? 'a distorted-text image'
        : challenge.kind === 'slider'
          ? 'a drag-the-piece-into-the-gap puzzle'
          : challenge.kind === 'select-image'
            ? 'an image grid'
            : 'a check a human must complete';
    this.log(
      'human',
      `⏸ Handing you ${shape}: “${challenge.prompt}”. A text-only model in your browser cannot see images — guessing here just fails your account, so the pilot stops and waits.`,
      app.id,
    );

    const reply = await this.awaitHuman(pending.id);
    if (reply.decision !== 'answer') {
      patchStep({ status: 'skipped', detail: 'Human did not complete the check.' });
      this.st.patchApplication(app.id, {
        status: 'failed',
        error: reply.decision === 'timeout' ? 'Timed out at the anti-bot wall.' : 'Operator skipped the anti-bot wall.',
      });
      this.log('warn', `Checkpoint abandoned — the ${job.company} application stops here.`, app.id);
      throw new SkipApplication();
    }
    patchStep({
      status: 'done',
      finishedAt: Date.now(),
      answer: reply.value,
      detail: `Cleared by you: “${reply.value}”`,
    });
    this.st.patchApplication(app.id, { status: 'filling' });
    this.log('good', 'Checkpoint cleared by you. Resuming the application.', app.id);
    await this.wait(420);
  }

  /** A language check the model could not settle: the operator answers it as a plain question. */
  private async escalateCheckpoint(app: Application, step: ApplicationStep, prompt: string, reason: string) {
    await this.escalate(app, step, prompt, reason);
    this.log('good', 'Checkpoint cleared by you. Resuming the application.', app.id);
    await this.wait(420);
  }

  private appendStep(app: Application, step: ApplicationStep): ApplicationStep {
    const current = this.st.applications.find((a) => a.id === app.id);
    this.st.patchApplication(app.id, { steps: [...(current?.steps ?? app.steps), step] });
    return step;
  }

  // --- field filling -------------------------------------------------------

  private async fillField(
    ai: LocalAI | null,
    profile: ResumeProfile,
    job: Job,
    field: FormField,
    app: Application,
    step: ApplicationStep,
  ): Promise<string> {
    await this.wait(220 + Math.random() * 260);

    switch (field.id) {
      case 'full_name':
        return profile.name;
      case 'email':
        return profile.email || 'no-email-found-on-resume@example.com';
      case 'phone':
        return profile.phone || 'Not provided';
      case 'location':
        return profile.location || 'Not provided';
      case 'links':
        return profile.links.slice(0, 2).join(' · ') || 'None listed';
      case 'years_exp':
        return String(profile.yearsExperience);
      case 'resume_file':
        return `resume.pdf — ${profile.name.replace(/\s+/g, '_')}.pdf (sent from this device)`;
      case 'work_auth':
        return this.escalate(app, step, field.label, 'Work authorisation is a legal declaration, not a resume line. The pilot will not infer it.');
      case 'notice':
        return this.escalate(app, step, field.label, 'Only you know your real notice period.');
      case 'salary':
        return this.escalate(app, step, field.label, 'A negotiating position is not a fact on your resume.');
      case 'cover_letter': {
        const matched = scoreJob(profile, job).matchedSkills;
        const text = await draftCoverLetter(ai?.ready ? ai : null, profile, job, matched);
        if (ai?.ready) {
          // Type it out so the operator can watch the model work. Each character is a
          // checkpoint, so pausing freezes the typing too.
          for (let i = 10; i <= text.length; i += 10) {
            this.st.patchStep(app.id, step.id, { detail: text.slice(0, i) });
            await this.wait(22);
          }
        }
        this.st.patchApplication(app.id, { coverLetter: text });
        return text;
      }
      default:
        return '';
    }
  }

  private async handleQuestion(
    ai: LocalAI | null,
    profile: ResumeProfile,
    job: Job,
    app: Application,
    step: ApplicationStep,
    question: string,
  ) {
    await this.checkpoint();
    this.st.patchStep(app.id, step.id, { status: 'running', startedAt: Date.now() });
    this.st.patchApplication(app.id, { status: 'filling' });
    this.log('ai', `Drafting an answer to the posting's own question: “${question}”`, app.id);

    const result = await answerQuestion(ai, profile, job, question);
    await this.wait(420);

    if (result.answer === '__NEEDS_HUMAN__' || result.answer === 'Human review' || result.confidence < 0.55) {
      // Only a real draft is offered as a suggestion; a placeholder never becomes an answer.
      const draft =
        result.answer && !/human review|__NEEDS_HUMAN__/i.test(result.answer) ? result.answer : undefined;
      return this.escalate(app, step, question, result.reason ?? 'Low confidence — the pilot will not guess on your behalf.', {
        suggestion: draft,
        confidence: result.confidence,
      });
    }

    this.st.patchStep(app.id, step.id, {
      status: 'done',
      finishedAt: Date.now(),
      answer: result.answer,
      confidence: result.confidence,
      detail: `${result.answer}${result.source === 'heuristic' ? ' (read straight off your resume)' : ` (drafted locally, ${Math.round(result.confidence * 100)}% conf)`}`,
    });
    this.log('good', `Answered without you (${Math.round(result.confidence * 100)}% conf): ${result.answer}`, app.id);
    return result.answer;
  }
}

export const pilot = new Pilot();
