import { jobsById } from '../data/jobs';
import type {
  Application,
  ApplicationStep,
  Job,
  JobMatch,
  LogEntry,
  PendingTask,
  ResumeProfile,
} from '../types';
import type { LocalAI } from '../ai/engine';
import { answerQuestion, draftCoverLetter, refineMatch } from '../ai/tasks';
import { makePendingChallenge, nextChallenge, solveChallengeWithAI } from '../ai/humanCheck';
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
// ---------------------------------------------------------------------------

/** Thrown to unwind one application without killing the whole run. */
class SkipApplication extends Error {}
/** Thrown when the operator hits stop. */
class RunStopped extends Error {}

export class Pilot {
  private paused = false;
  private stopped = false;
  private waiters = new Map<string, { resolve: (v: HumanReply) => void }>();
  private running = false;
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

  private async checkpoint() {
    while (this.paused && !this.stopped) await sleep(120);
    if (this.stopped) throw new RunStopped();
  }

  pause() {
    if (!this.running) return;
    this.paused = true;
    this.st.setPhase('paused');
    this.log('warn', 'Run paused by operator. The pilot holds at the next checkpoint.');
  }

  resume() {
    if (!this.running) return;
    this.paused = false;
    this.st.setPhase('running');
    this.log('info', 'Run resumed.');
  }

  stop() {
    this.stopped = true;
    this.paused = false;
    this.ai?.interrupt();
    for (const [, w] of this.waiters) w.resolve({ value: '', decision: 'skip' });
    this.waiters.clear();
    this.running = false;
    this.st.setPhase('stopped');
    this.st.setActiveAppId(null);
    this.log('warn', 'Run stopped by operator. Applications already submitted stay submitted.');
  }

  // --- human-in-the-loop plumbing -----------------------------------------

  answerPending(taskId: string, value: string) {
    const w = this.waiters.get(taskId);
    if (w) {
      this.waiters.delete(taskId);
      w.resolve({ value, decision: value ? 'answer' : 'skip' });
    }
    this.st.resolvePending(taskId);
  }

  skipPending(taskId: string) {
    const w = this.waiters.get(taskId);
    if (w) {
      this.waiters.delete(taskId);
      w.resolve({ value: '', decision: 'skip' });
    }
    this.st.resolvePending(taskId);
  }

  private awaitHuman(taskId: string): Promise<HumanReply> {
    return new Promise<HumanReply>((resolve) => {
      this.waiters.set(taskId, { resolve });
      const timeout = this.st.criteria.humanCheckTimeoutMs;
      if (timeout > 0) {
        setTimeout(() => {
          const w = this.waiters.get(taskId);
          if (!w) return;
          this.waiters.delete(taskId);
          this.st.resolvePending(taskId);
          this.log(
            'warn',
            'No answer within the wait window — abandoning this application rather than guessing on your behalf. Raise “wait for me” in the Briefing filters if you need longer.',
          );
          w.resolve({ value: '', decision: 'timeout' });
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

  async run(ai: LocalAI | null, matches: JobMatch[], criteria: Criteria, profile: ResumeProfile) {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.stopped = false;
    this.ai = ai;

    const st = this.st;
    st.setPhase('running');
    st.setActiveAppId(null);

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
        const job = jobsById.get(queue[i].jobId)!;
        st.log('info', `── ${i + 1}/${queue.length} · ${job.title} @ ${job.company} ──`);
        try {
          await this.runOne(ai, profile, job, queue[i], criteria, i);
        } catch (e) {
          if (e instanceof RunStopped) break;
          if (e instanceof SkipApplication) {
            this.log('info', `Moving on. The ${job.company} application was left unsent on purpose.`);
          } else {
            this.log('warn', `Application to ${job.company} failed: ${(e as Error)?.message ?? e}`);
            st.patchApplication(st.activeAppId ?? '', { status: 'failed', error: (e as Error)?.message });
          }
        }
        const done = this.st;
        done.setActiveAppId(null);
        await this.wait(420);
      }

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
    } catch (e) {
      if (!(e instanceof RunStopped)) this.log('warn', `Pilot halted: ${(e as Error)?.message ?? e}`);
    } finally {
      this.running = false;
      if (useStore.getState().phase === 'running' || useStore.getState().phase === 'paused')
        useStore.getState().setPhase('finished');
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
      final = { ...final, matchedSkills: known.matchedSkills, missingSkills: final.missingSkills.length ? final.missingSkills : known.missingSkills };
      this.log(
        final.verdict === 'strong' ? 'good' : 'info',
        `Fit ${final.score}/100 (${final.verdict}). ${final.rationale}`,
        appId,
      );
      patch({ score: final.score, match: final });
      patchStep(matchStep.id, { detail: `${final.score}/100 · ${final.verdict}`, confidence: final.score / 100 });
    });

    // Hard gate — never spray a doomed application into a known auto-reject.
    if (final.score < 35) {
      this.log('warn', `Not submitting to ${job.company}: ${final.rationale}`, appId);
      patch({ status: 'failed', error: final.rationale });
      for (const s of [fieldSteps, [checkStep, submitStep, confirmStep]].flat())
        patchStep(s.id, { status: 'skipped' });
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
        this.log(
          'human',
          `Filled “${field.label}” → ${value.length > 100 ? `${value.slice(0, 100)}…` : value}`,
          appId,
        );
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
      const step = round === 0 ? checkStep : this.appendStep(app, {
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

    await run(submitStep, async () => {
      this.log('info', `Clicking “Submit application” on the ${job.company} portal…`, appId);
      await this.wait(880 + Math.random() * 500);
    }, 'Submit clicked');

    const receipt = confirmationId(job.company, job.title);
    await run(confirmStep, async () => {
      await this.wait(420);
    }, `Receipt ${receipt}`);

    patch({ status: 'submitted', confirmationId: receipt, coverLetter: filled.get('cover_letter') });
    this.log('good', `✅ Submitted to ${job.company} for “${job.title}” — confirmation ${receipt}.`, appId);
  }

  /** One anti-bot wall: agent-solved, model-solved, or escalated to the human. */
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

    if (challenge.solvableBy === 'ai' && ai?.ready) {
      this.log(
        'ai',
        `Checkpoint: “${challenge.prompt}” — a language puzzle, which is exactly what a small language model is good at.`,
        app.id,
      );
      const solved = await solveChallengeWithAI(
        (p) => ai.complete([{ role: 'user', content: p }], { maxTokens: 10, temperature: 0 }).then((r) => r.trim()),
        challenge,
      );
      await this.wait(700);
      const guess = solved?.answer ?? '';
      const expected = (challenge.answer ?? '').toLowerCase();
      const ok = !!guess && (expected.includes(guess) || guess.includes(expected));
      if (ok) {
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
      this.log('warn', `Pilot's answer “${guess || '(nothing)'}” was rejected. Escalating to you.`, app.id);
      challenge.kind = 'text-image';
      challenge.solvableBy = 'human';
      challenge.humanAnswer = (challenge.answer ?? 'motorcycle').toUpperCase().slice(0, 6);
      challenge.prompt = `Type the characters in the image: ${challenge.humanAnswer}`;
    }

    // Honest hand-off: we cannot see images from a text model in a tab.
    const pending = makePendingChallenge(app.id, job.id, job.title, job.company, step.id, challenge);
    this.st.addPending(pending);
    this.st.patchApplication(app.id, { status: 'needs-you' });
    patchStep({
      status: 'blocked',
      detail: challenge.prompt,
      questionId: pending.id,
    });
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
    const patchStep = (p: Partial<ApplicationStep>) => this.st.patchStep(app.id, step.id, p);

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
        return this.escalate(
          app,
          step,
          field.label,
          'Work authorisation is a legal declaration, not a resume line. The pilot will not infer it.',
        );
      case 'notice':
        return this.escalate(app, step, field.label, 'Only you know your real notice period.');
      case 'salary':
        return this.escalate(app, step, field.label, 'A negotiating position is not a fact on your resume.');
      case 'cover_letter': {
        const matched = scoreJob(profile, job).matchedSkills;
        if (ai?.ready) {
          const text = await draftCoverLetter(ai, profile, job, matched);
          // Type it out so the operator can watch the model work.
          for (let i = 10; i <= text.length; i += 10) {
            patchStep({ detail: text.slice(0, i) });
            await sleep(22 / this.speed);
          }
          this.st.patchApplication(app.id, { coverLetter: text });
          return text;
        }
        const text = await draftCoverLetter(null, profile, job, matched);
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
      const draft = result.answer && !/human review|__NEEDS_HUMAN__/i.test(result.answer) ? result.answer : undefined;
      const value = await this.escalate(
        app,
        step,
        question,
        result.reason ?? 'Low confidence — the pilot will not guess on your behalf.',
        { suggestion: draft, confidence: result.confidence },
      );
      return value;
    }

    this.st.patchStep(app.id, step.id, {
      status: 'done',
      finishedAt: Date.now(),
      answer: result.answer,
      confidence: result.confidence,
      detail: `${result.answer}${result.source === 'heuristic' ? ' (read straight off your resume)' : ` (drafted locally, ${Math.round(result.confidence * 100)}% conf)`}`,
    });
    this.log(
      'good',
      `Answered without you (${Math.round(result.confidence * 100)}% conf): ${result.answer}`,
      app.id,
    );
  }
}

interface HumanReply {
  value: string;
  decision: 'answer' | 'skip' | 'timeout';
}

export const pilot = new Pilot();
