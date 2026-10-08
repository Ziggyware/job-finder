import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { ai } from '../ai/instance';
import { cx, scrollToBottom, truncate } from '../lib/util';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

// ---------------------------------------------------------------------------
// "Ask the pilot" — a chat surface over the run's own state.
//
// With a model loaded this is a normal local conversation, grounded in a compact
// snapshot of the profile, the queue and the audit log. With no model it still
// answers the factual questions ("how many went out?", "what is still blocked?")
// from the store directly — a chat box that only tells you to download 600MB is
// not an answer.
// ---------------------------------------------------------------------------

export default function AskPilot() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const engine = useStore((s) => s.engine);

  useEffect(() => {
    scrollToBottom(scrollRef.current);
  }, [msgs, thinking, open]);

  const snapshot = usePilotContext();

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || thinking) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', content: q }]);
    setThinking(true);

    if (!ai.ready) {
      await new Promise((r) => setTimeout(r, 380));
      setMsgs((m) => [...m, { role: 'assistant', content: heuristicAnswer(q, snapshot) }]);
      setThinking(false);
      return;
    }

    try {
      const history = [...msgs, { role: 'user' as const, content: q }].slice(-6);
      setMsgs((m) => [...m, { role: 'assistant', content: '' }]);
      await ai.complete(
        [
          {
            role: 'system',
            content: [
              'You are the JobPilot copilot: a terse, honest assistant embedded in a job-application agent that runs entirely on the user\'s own GPU.',
              'Answer using ONLY the RUN SNAPSHOT. If the snapshot does not contain the answer, say so in one sentence and name what you would need.',
              'Never invent companies, scores, counts or receipts. Two to four sentences maximum. Plain text, no markdown headings.',
              '',
              'RUN SNAPSHOT',
              snapshot,
            ].join('\n'),
          },
          ...history.map((m) => ({ role: m.role, content: m.content })),
        ],
        {
          maxTokens: 260,
          temperature: 0.3,
          onToken: (partial) =>
            setMsgs((m) => {
              const next = [...m];
              next[next.length - 1] = { role: 'assistant', content: partial };
              return next;
            }),
        },
      );
    } catch (e) {
      setMsgs((m) => {
        const next = [...m];
        next[next.length - 1] = {
          role: 'assistant',
          content: `The local model threw an error: ${(e as Error).message}. ${heuristicAnswer(q, snapshot)}`,
        };
        return next;
      });
    } finally {
      setThinking(false);
    }
  };

  const suggestions = useMemo(
    () => [
      'How many applications went out?',
      'What is waiting on me?',
      'Which posting is the weakest fit and why?',
      'What did you refuse to answer yourself?',
    ],
    [],
  );

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium shadow-2xl transition-all',
          open
            ? 'border-[var(--color-line-2)] bg-[var(--color-panel-2)]'
            : 'border-[var(--color-pilot-dim)] bg-gradient-to-b from-[#ffc24d] to-[#f2a007] text-black hover:-translate-y-0.5',
        )}
      >
        <span>{open ? '✕' : '◆'}</span>
        <span>{open ? 'Close' : 'Ask the pilot'}</span>
        {engine.state === 'generating' && !open && <span className="mono text-[10px] opacity-70">thinking…</span>}
      </button>

      {open && (
        <div className="panel fixed bottom-20 right-5 z-40 flex h-[30rem] w-[min(28rem,calc(100vw-2.5rem))] flex-col overflow-hidden shadow-2xl">
          <div className="border-b border-[var(--color-line)] px-3.5 py-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wide text-[var(--color-mute)]">ASK THE PILOT</h2>
              <span className="mono text-[9px] text-[var(--color-mute-2)]">
                {ai.ready ? truncate(engine.modelId.replace(/-MLC$/, ''), 26) : 'no model — rule-based'}
              </span>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-mute-2)]">
              Answers are grounded in this run's state only. Asking costs nothing — the model is on your GPU.
            </p>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {msgs.length === 0 && (
              <div className="space-y-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-2)] px-2.5 py-2 text-left text-[11px] text-[var(--color-mute)] hover:border-[var(--color-line-2)]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div
                key={i}
                className={cx(
                  'fade-up max-w-[92%] rounded-xl px-2.5 py-2 text-[11px] leading-relaxed whitespace-pre-wrap',
                  m.role === 'user'
                    ? 'ml-auto border border-[var(--color-line-2)] bg-[var(--color-panel-2)]'
                    : 'border border-[var(--color-line)] bg-[var(--color-ink-2)] text-[var(--color-mute)]',
                )}
              >
                {m.content || (thinking ? <span className="mono text-[var(--color-pilot)]">▍</span> : null)}
              </div>
            ))}
          </div>

          <div className="border-t border-[var(--color-line)] p-2.5">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void send(input)}
                placeholder="Ask about the run…"
                className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--color-line-2)]"
              />
              <button className="btn btn-primary" onClick={() => void send(input)} disabled={thinking || !input.trim()}>
                Ask
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Compact, factual description of the current run — the model's whole world. */
function usePilotContext() {
  const profile = useStore((s) => s.profile);
  const applications = useStore((s) => s.applications);
  const pending = useStore((s) => s.pending);
  const matches = useStore((s) => s.matches);
  const phase = useStore((s) => s.phase);
  const engine = useStore((s) => s.engine);
  const criteria = useStore((s) => s.criteria);
  const logs = useStore((s) => s.logs);

  return useMemo(() => {
    const lines: string[] = [];
    lines.push(`Run phase: ${phase}`);
    lines.push(`Engine: ${engine.state}${engine.modelId ? ` (${engine.modelId})` : ''}`);
    lines.push(
      `Criteria: min score ${criteria.minScore}, max ${criteria.maxApplications} applications, auto-submit ${criteria.autoSubmit ? 'on' : 'off'}, posted within ${criteria.maxAgeDays || 'any'} days.`,
    );
    if (profile) {
      lines.push(
        `Candidate: ${profile.name}, ${profile.yearsExperience} years, skills: ${profile.skills.slice(0, 18).join(', ')}.`,
      );
    }
    lines.push(`Postings ranked: ${matches.length}.`);
    lines.push(
      `Applications: ${applications.length} started, ${applications.filter((a) => a.status === 'submitted').length} submitted, ${applications.filter((a) => a.status === 'failed').length} not sent.`,
    );
    for (const a of applications.slice(0, 8)) {
      const done = a.steps.filter((s) => s.status === 'done').length;
      lines.push(
        `- ${a.job.title} @ ${a.job.company}: status ${a.status}, score ${a.score ?? 'n/a'}, ${done}/${a.steps.length} steps${a.confirmationId ? `, receipt ${a.confirmationId}` : ''}${a.error ? `, stopped because: ${a.error}` : ''}.`,
      );
      if (a.coverLetter) lines.push(`  cover letter drafted: "${truncate(a.coverLetter, 160)}"`);
    }
    if (pending.length) {
      lines.push('Waiting on the human:');
      for (const p of pending) {
        lines.push(`- ${p.company}: ${p.question ?? p.challengePrompt}${p.reason ? ` (why: ${p.reason})` : ''}`);
      }
    } else {
      lines.push('Waiting on the human: nothing.');
    }
    lines.push('Recent audit log:');
    for (const l of logs.slice(-24)) lines.push(`- [${l.level}] ${truncate(l.text, 200)}`);
    return lines.join('\n');
  }, [profile, applications, pending, matches, phase, engine, criteria, logs]);
}

/** No-model fallback: answer the numeric/state questions honestly. */
function heuristicAnswer(q: string, snapshot: string): string {
  const s = useStore.getState();
  const submitted = s.applications.filter((a) => a.status === 'submitted');
  const blocked = s.applications.filter((a) => a.status === 'needs-you');
  const failed = s.applications.filter((a) => a.status === 'failed');
  const lower = q.toLowerCase();

  if (/how many|count|submitted|went out|sent/.test(lower)) {
    return `${submitted.length} submitted so far${failed.length ? `, ${failed.length} deliberately not sent` : ''}. ${submitted.length ? `Receipts: ${submitted.map((a) => `${a.job.company} ${a.confirmationId}`).join(', ')}.` : ''}`;
  }
  if (/waiting|needs me|blocked|pending|human/.test(lower)) {
    if (!blocked.length && !s.pending.length) return 'Nothing is waiting on you right now.';
    return `${s.pending.length} item(s) are parked for you: ${s.pending.map((p) => `${p.company} — ${p.question ?? p.challengePrompt}`).join(' | ')}`;
  }
  if (/weakest|worst|lowest|best|strongest|fit/.test(lower)) {
    const ranked = [...s.matches].sort((a, b) => b.score - a.score);
    if (!ranked.length) return 'No postings have been ranked yet — load a resume first.';
    const low = ranked[ranked.length - 1];
    const job = s.applications.find((a) => a.jobId === low.jobId)?.job;
    return `Weakest fit in the queue is ${job?.title ?? low.jobId} at ${job?.company ?? 'unknown'} (${low.score}/100): ${truncate(low.rationale, 220)}`;
  }
  if (/refuse|decline|not answer|sensitive|captcha|human check/.test(lower)) {
    return 'The pilot refuses four things: work authorisation, notice/availability, salary expectations, and any credential or clearance claim. Visual anti-bot walls also come to you, because a text model in a browser tab cannot see images.';
  }
  if (/model|ai|free|cost|api/.test(lower)) {
    return `No model is loaded, so I am answering from the run state directly. Loading one costs nothing beyond the one-time download — it runs on your GPU via WebGPU with no API key. Current engine state: ${s.engine.state}.`;
  }
  return `I can answer from the run state without a model (counts, receipts, what is blocked, which fit is weakest). For free-form questions, load a local model in the model panel — it runs on your GPU, no key needed. Snapshot length: ${snapshot.length} characters.`;
}
