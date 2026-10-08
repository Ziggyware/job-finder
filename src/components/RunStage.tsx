import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store';
import { jobsById } from '../data/jobs';
import { cx, scrollToBottom } from '../lib/util';
import type { Application, ApplicationStep, StepKind, StepStatus } from '../types';
import HumanPanel from './HumanPanel';

const KIND_ICON: Record<StepKind, string> = {
  navigate: '⌖',
  analyze: '◫',
  match: '◆',
  field: '▤',
  answer: '?',
  'human-check': '⛨',
  submit: '▶',
  confirmed: '✓',
};

const STATUS_STYLE: Record<StepStatus, { dot: string; text: string; ring: string }> = {
  pending: { dot: 'var(--color-line-2)', text: 'var(--color-mute-2)', ring: 'transparent' },
  running: { dot: 'var(--color-pilot)', text: 'var(--color-fg)', ring: 'var(--color-pilot)' },
  done: { dot: 'var(--color-good)', text: 'var(--color-fg)', ring: 'transparent' },
  blocked: { dot: 'var(--color-you)', text: 'var(--color-fg)', ring: 'var(--color-you)' },
  skipped: { dot: 'var(--color-mute-2)', text: 'var(--color-mute-2)', ring: 'transparent' },
  failed: { dot: 'var(--color-bad)', text: '#e59a9a', ring: 'transparent' },
};

export default function RunStage() {
  const applications = useStore((s) => s.applications);
  const activeAppId = useStore((s) => s.activeAppId);
  const phase = useStore((s) => s.phase);
  const pending = useStore((s) => s.pending);
  const setActive = useStore((s) => s.setActiveAppId);

  const active = useMemo(
    () => applications.find((a) => a.id === activeAppId) ?? applications.find((a) => a.status === 'needs-you') ?? applications[0],
    [applications, activeAppId],
  );

  const stats = useMemo(() => {
    const submitted = applications.filter((a) => a.status === 'submitted').length;
    const parked = applications.filter((a) => a.status === 'needs-you').length;
    const failed = applications.filter((a) => a.status === 'failed').length;
    const running = applications.filter((a) => a.status === 'filling' || a.status === 'analyzing').length;
    return { submitted, parked, failed, running };
  }, [applications]);

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5">
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Submitted" value={stats.submitted} tone="good" />
        <Stat label="Running" value={stats.running} tone="pilot" />
        <Stat label="Waiting on you" value={pending.length} tone="you" />
        <Stat label="Not sent" value={stats.failed} tone="mute" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[290px_minmax(0,1fr)_380px]">
        {/* ---------------- queue rail ---------------- */}
        <div className="panel flex max-h-[calc(100vh-11rem)] flex-col overflow-hidden">
          <div className="border-b border-[var(--color-line)] px-3.5 py-3">
            <h2 className="text-xs font-semibold tracking-wide text-[var(--color-mute)]">FLEET</h2>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-mute-2)]">
              One application at a time. The pilot is on {phase === 'running' ? 'autopilot' : phase}.
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {applications.length === 0 && (
              <p className="p-3 text-xs text-[var(--color-mute-2)]">Nothing has started yet.</p>
            )}
            {applications.map((a) => (
              <ApplicationRow
                key={a.id}
                app={a}
                active={a.id === active?.id}
                onClick={() => setActive(a.id)}
              />
            ))}
          </div>
        </div>

        {/* ---------------- theatre ---------------- */}
        <div className="min-w-0">
          {active ? <Theatre app={active} /> : <EmptyTheatre />}
        </div>

        {/* ---------------- needs-you + log ---------------- */}
        <div className="min-w-0">
          <RightColumn />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'good' | 'pilot' | 'you' | 'mute' }) {
  const color =
    tone === 'good'
      ? 'var(--color-good)'
      : tone === 'pilot'
        ? 'var(--color-pilot)'
        : tone === 'you'
          ? 'var(--color-you)'
          : 'var(--color-mute)';
  return (
    <div className="panel px-3.5 py-2.5">
      <div className="mono text-xl font-semibold" style={{ color }}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] tracking-wide text-[var(--color-mute-2)]">{label.toUpperCase()}</div>
    </div>
  );
}

function ApplicationRow({ app, active, onClick }: { app: Application; active: boolean; onClick: () => void }) {
  const done = app.steps.filter((s) => s.status === 'done').length;
  const pct = Math.round((done / Math.max(app.steps.length, 1)) * 100);
  const badge =
    app.status === 'submitted'
      ? { text: 'submitted', cls: 'text-[var(--color-good)] border-[#1d4d3a]' }
      : app.status === 'needs-you'
        ? { text: 'needs you', cls: 'text-[var(--color-you)] border-[#43265c]' }
        : app.status === 'failed'
          ? { text: 'not sent', cls: 'text-[#e59a9a] border-[#4a2b2b]' }
          : app.status === 'filling' || app.status === 'analyzing'
            ? { text: 'running', cls: 'text-[var(--color-pilot)] border-[var(--color-pilot-dim)]' }
            : { text: 'queued', cls: 'text-[var(--color-mute-2)]' };

  return (
    <button
      onClick={onClick}
      className={cx(
        'fade-up mb-1.5 w-full rounded-xl border p-2.5 text-left transition-all',
        active
          ? 'border-[var(--color-line-2)] bg-[var(--color-panel-2)]'
          : 'border-transparent hover:border-[var(--color-line)] hover:bg-[var(--color-ink-2)]',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{jobsById.get(app.jobId)?.title}</div>
          <div className="truncate text-[10px] text-[var(--color-pilot)]">{app.job.company}</div>
        </div>
        <span className={cx('chip shrink-0', badge.cls)}>{badge.text}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-line)]">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background:
                app.status === 'failed'
                  ? 'var(--color-bad)'
                  : app.status === 'needs-you'
                    ? 'var(--color-you)'
                    : 'var(--color-pilot)',
            }}
          />
        </div>
        <span className="mono text-[9px] text-[var(--color-mute-2)]">
          {done}/{app.steps.length}
        </span>
      </div>
      {app.confirmationId && (
        <div className="mono mt-1.5 text-[9px] text-[var(--color-good)]">receipt {app.confirmationId}</div>
      )}
    </button>
  );
}

function Theatre({ app }: { app: Application }) {
  const job = app.job;
  const engine = useStore((s) => s.engine);
  const listRef = useRef<HTMLDivElement>(null);
  const runningStep = app.steps.find((s) => s.status === 'running');

  useEffect(() => {
    scrollToBottom(listRef.current);
  }, [app.steps.length, runningStep?.id]);

  return (
    <div className="panel overflow-hidden">
      {/* fake browser chrome */}
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] bg-[var(--color-ink-2)] px-3 py-2">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#3a2530]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#3a3520]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#213a2b]" />
        </div>
        <div className="mono ml-1 flex-1 truncate rounded-md border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1 text-[10px] text-[var(--color-mute-2)]">
          https://{job.company.toLowerCase().replace(/[^a-z]/g, '')}.jobs/apply/{job.id} —
          <span className="text-[var(--color-mute-2)]"> drive is scripted, this is a fictional portal</span>
        </div>
        <span className="chip shrink-0 text-[var(--color-mute-2)]">
          {engine.state === 'generating' ? (
            <span className="text-[var(--color-pilot)]">◆ model thinking…</span>
          ) : (
            'idle'
          )}
        </span>
      </div>

      <div className="border-b border-[var(--color-line)] px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-semibold">{job.title}</h2>
          <span className="text-xs text-[var(--color-pilot)]">{job.company}</span>
          <span className="mono text-[10px] text-[var(--color-mute-2)]">
            {job.location} · {job.remote} · {job.salary}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {app.match?.matchedSkills.slice(0, 7).map((s) => (
            <span key={s} className="chip border-[#1d4d3a] text-[var(--color-good)]">
              ✓ {s}
            </span>
          ))}
          {app.match?.missingSkills.slice(0, 3).map((s) => (
            <span key={s} className="chip border-[#4a2b2b] text-[#e59a9a]">
              ✗ {s}
            </span>
          ))}
        </div>
        {app.status === 'failed' && app.error && (
          <div className="mt-3 rounded-lg border border-[#4a2b2b] bg-[#1b1010] p-2.5 text-[11px] leading-relaxed text-[#e59a9a]">
            Stopped, deliberately: {app.error}
          </div>
        )}
        {app.status === 'submitted' && (
          <div className="mt-3 rounded-lg border border-[#1d4d3a] bg-[#0e1a15] p-2.5 text-[11px] leading-relaxed text-[#8ee7c2]">
            Submitted. Receipt <span className="mono">{app.confirmationId}</span>. Nothing further is sent for this
            posting.
          </div>
        )}
      </div>

      <div ref={listRef} className="max-h-[calc(100vh-24rem)] min-h-[22rem] overflow-y-auto px-4 py-3">
        <ol className="space-y-0.5">
          {app.steps.map((s, i) => (
            <StepRow key={s.id} step={s} index={i} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function StepRow({ step, index }: { step: ApplicationStep; index: number }) {
  const st = STATUS_STYLE[step.status];
  const live = step.status === 'running';
  const showDetail = step.detail && (step.kind === 'field' || step.kind === 'answer' || step.kind === 'human-check' || live);
  const isLetter = step.questionId === 'cover_letter';

  return (
    <li className="fade-up relative flex gap-3 py-1.5">
      {index < 99 && (
        <span
          className="absolute left-[13px] top-7 h-full w-px"
          style={{ background: step.status === 'done' ? 'var(--color-line-2)' : 'var(--color-line)' }}
        />
      )}
      <span
        className={cx(
          'relative z-10 mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border text-[11px]',
          live && 'pulse-ring',
        )}
        style={{ borderColor: st.ring, color: st.dot, background: 'var(--color-panel)' }}
      >
        {step.status === 'done' ? '✓' : step.status === 'failed' ? '✕' : step.status === 'blocked' ? '⏸' : KIND_ICON[step.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs" style={{ color: st.text }}>
            {step.label}
          </span>
          {live && <span className="mono text-[9px] text-[var(--color-pilot)]">running…</span>}
          {step.confidence !== undefined && step.status === 'done' && (
            <span className="mono text-[9px] text-[var(--color-mute-2)]">
              {Math.round(step.confidence * 100)}% conf
            </span>
          )}
        </div>
        {showDetail && (
          <div
            className={cx(
              'mono mt-1 whitespace-pre-wrap break-words rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-2)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--color-mute)]',
              live && isLetter && 'caret',
            )}
          >
            {step.detail}
          </div>
        )}
      </div>
    </li>
  );
}

function EmptyTheatre() {
  return (
    <div className="panel flex min-h-[24rem] flex-col items-center justify-center p-10 text-center">
      <div className="mb-3 text-3xl opacity-60">🛫</div>
      <h2 className="text-sm font-semibold">No application in flight</h2>
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-[var(--color-mute-2)]">
        Pick postings in the Briefing tab and start the pilot. Every filled field, every drafted sentence and every
        checkpoint lands here as it happens.
      </p>
    </div>
  );
}

function RightColumn() {
  return (
    <div className="space-y-4">
      <NeedsYou />
      <ActivityLog />
    </div>
  );
}

function NeedsYou() {
  const pending = useStore((s) => s.pending);
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-[var(--color-mute)]">NEEDS YOU</h2>
        {pending.length > 0 && (
          <span className="chip border-[#43265c] text-[var(--color-you)]">{pending.length} waiting</span>
        )}
      </div>
      <HumanPanel />
    </div>
  );
}

function ActivityLog() {
  const logs = useStore((s) => s.logs);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollToBottom(ref.current);
  }, [logs.length]);

  const color: Record<string, string> = {
    info: 'var(--color-mute)',
    ai: 'var(--color-pilot)',
    warn: '#ffd88a',
    good: 'var(--color-good)',
    human: 'var(--color-you)',
  };
  const tag: Record<string, string> = { info: '·', ai: '◆', warn: '!', good: '✓', human: '☾' };

  return (
    <div className="panel flex max-h-[38vh] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--color-line)] px-3.5 py-2.5">
        <h2 className="text-xs font-semibold tracking-wide text-[var(--color-mute)]">AUDIT LOG</h2>
        <span className="mono text-[9px] text-[var(--color-mute-2)]">{logs.length} entries</span>
      </div>
      <div ref={ref} className="flex-1 overflow-y-auto px-3 py-2">
        {logs.length === 0 && (
          <p className="py-2 text-[11px] text-[var(--color-mute-2)]">
            Nothing yet. The pilot narrates every action here.
          </p>
        )}
        {logs.map((l) => (
          <div key={l.id} className="fade-up flex gap-2 py-1">
            <span className="mono shrink-0 text-[10px]" style={{ color: color[l.level] ?? 'var(--color-mute)' }}>
              {tag[l.level] ?? '·'}
            </span>
            <span className="min-w-0 text-[11px] leading-relaxed" style={{ color: color[l.level] }}>
              {l.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
