import { useMemo } from 'react';
import { useStore } from '../store';
import { jobsById, JOBS } from '../data/jobs';
import { rankJobs } from '../lib/match';
import { ai } from '../ai/instance';
import { pilot } from '../agent/pilot';
import { cx, truncate } from '../lib/util';
import type { JobMatch } from '../types';

export default function BriefingStage() {
  const profile = useStore((s) => s.profile)!;
  const matches = useStore((s) => s.matches);
  const selected = useStore((s) => s.selectedJobIds);
  const criteria = useStore((s) => s.criteria);
  const setCriteria = useStore((s) => s.setCriteria);
  const setMatches = useStore((s) => s.setMatches);
  const setSelected = useStore((s) => s.setSelectedJobIds);
  const toggleJob = useStore((s) => s.toggleJob);
  const log = useStore((s) => s.log);
  const engine = useStore((s) => s.engine);

  const visible = useMemo(
    () => matches.filter((m) => m.score >= Math.min(criteria.minScore, 35)),
    [matches, criteria.minScore],
  );

  const queued = useMemo(
    () =>
      selected
        .map((id) => matches.find((m) => m.jobId === id))
        .filter((m): m is JobMatch => !!m)
        .sort((a, b) => b.score - a.score),
    [selected, matches],
  );

  const reRank = () => {
    const next = rankJobs(profile, JOBS, {
      maxAgeDays: criteria.maxAgeDays,
      remoteOnly: criteria.remoteOnly,
    });
    setMatches(next);
    log(
      'info',
      `Re-ranked ${next.length} postings with the current filters (min score ${criteria.minScore}, posted within ${criteria.maxAgeDays || 'any'} days${criteria.remoteOnly ? ', remote only' : ''}).`,
    );
  };

  const start = () => {
    const queue = queued.filter((m) => m.score >= criteria.minScore);
    if (!queue.length) {
      log('warn', 'Nothing selected above the minimum score — pick at least one posting to run.');
      return;
    }
    useStore.getState().resetRun();
    void pilot.run(ai.ready ? ai : null, queue, criteria, profile);
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Briefing</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-mute)]">
            {matches.length} postings ranked against {profile.name}'s resume. The score is evidence-based — required
            skills covered, title overlap, seniority fit, recency — and the local model rewrites each rationale as the
            run goes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={reRank}>
            ↻ Re-rank with filters
          </button>
          <button className="btn" onClick={() => setSelected(visible.filter((m) => m.score >= criteria.minScore).map((m) => m.jobId))}>
            Select all above {criteria.minScore}
          </button>
          <button className="btn btn-ghost" onClick={() => setSelected([])}>
            Clear
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-2.5">
          {visible.map((m) => {
            const job = jobsById.get(m.jobId)!;
            const checked = selected.includes(m.jobId);
            const doomed = m.verdict === 'stretch' && m.score < 35;
            return (
              <div
                key={m.jobId}
                className={cx(
                  'card-hover rounded-xl border p-4',
                  checked ? 'border-[var(--color-pilot-dim)] bg-[#15120a]' : 'border-[var(--color-line)] bg-[var(--color-panel)]',
                  doomed && 'opacity-70',
                )}
              >
                <div className="flex gap-4">
                  <button
                    onClick={() => toggleJob(m.jobId)}
                    className={cx(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-bold',
                      checked
                        ? 'border-[var(--color-pilot)] bg-[var(--color-pilot)] text-black'
                        : 'border-[var(--color-line-2)] text-transparent hover:border-[var(--color-mute)]',
                    )}
                    aria-label={checked ? 'Deselect' : 'Select'}
                  >
                    ✓
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="text-sm font-semibold">{job.title}</h3>
                      <span className="text-xs text-[var(--color-pilot)]">{job.company}</span>
                      <span className="mono text-[10px] text-[var(--color-mute-2)]">
                        {job.location} · {job.remote} · posted {job.postedDaysAgo}d ago · {job.applicantCount} applicants
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-mute)]">{truncate(m.rationale, 260)}</p>

                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {m.matchedSkills.slice(0, 6).map((s) => (
                        <span key={s} className="chip border-[#1d4d3a] text-[var(--color-good)]">
                          ✓ {s}
                        </span>
                      ))}
                      {m.missingSkills.slice(0, 4).map((s) => (
                        <span key={s} className="chip border-[#4a2b2b] text-[#e59a9a]">
                          ✗ {s}
                        </span>
                      ))}
                      {m.source === 'ai' && <span className="chip text-[var(--color-pilot)]">◆ model-reviewed</span>}
                    </div>

                    <div className="mono mt-2 text-[10px] text-[var(--color-mute-2)]">
                      {job.salary} · {job.employment} · {job.seniority}
                    </div>
                  </div>
                  <ScoreDial score={m.score} verdict={m.verdict} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="panel p-4">
            <h2 className="text-sm font-semibold">Run order</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-mute-2)]">
              The pilot works the list top to bottom, one application at a time, and stops whenever it needs you.
            </p>
            <div className="mt-3 space-y-1.5">
              {queued.length === 0 && (
                <p className="text-xs text-[var(--color-mute-2)]">Nothing selected yet.</p>
              )}
              {queued.map((m, i) => {
                const job = jobsById.get(m.jobId)!;
                return (
                  <div key={m.jobId} className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-2)] px-2.5 py-2">
                    <span className="mono w-4 shrink-0 text-[10px] text-[var(--color-mute-2)]">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{job.title}</span>
                      <span className="block truncate text-[10px] text-[var(--color-mute-2)]">{job.company}</span>
                    </span>
                    <span className="mono shrink-0 text-[10px] text-[var(--color-pilot)]">{m.score}</span>
                  </div>
                );
              })}
            </div>

            <button
              className="btn btn-primary mt-4 w-full"
              onClick={start}
              disabled={!queued.length || pilot.isRunning}
            >
              ▶ Start the pilot ({queued.filter((m) => m.score >= criteria.minScore).length} applications)
            </button>
            <p className="mt-2 text-center text-[10px] leading-relaxed text-[var(--color-mute-2)]">
              {engine.state === 'ready'
                ? `Will draft with ${engine.modelId}`
                : 'No model loaded — will run in heuristic mode'}
            </p>
          </div>

          <div className="panel p-4">
            <h2 className="text-sm font-semibold">Matching filters</h2>
            <div className="mt-3 space-y-4">
              <Slider
                label="Minimum match score"
                value={criteria.minScore}
                min={30}
                max={95}
                step={5}
                onChange={(v) => setCriteria({ minScore: v })}
                hint="Postings below this are shown but never queued."
              />
              <Slider
                label="Maximum applications this run"
                value={criteria.maxApplications}
                min={1}
                max={12}
                step={1}
                onChange={(v) => setCriteria({ maxApplications: v })}
                hint="A cap keeps a runaway run from spraying the internet."
              />
              <Slider
                label="Posted within (days, 0 = any)"
                value={criteria.maxAgeDays}
                min={0}
                max={30}
                step={1}
                onChange={(v) => setCriteria({ maxAgeDays: v })}
              />
              <label className="flex items-center justify-between gap-3 text-xs">
                <span className="text-[var(--color-mute)]">Remote-friendly postings only</span>
                <Toggle value={criteria.remoteOnly} onChange={(v) => setCriteria({ remoteOnly: v })} />
              </label>
              <label className="flex items-center justify-between gap-3 text-xs">
                <span className="text-[var(--color-mute)]">
                  Auto-submit
                  <span className="mt-0.5 block text-[10px] text-[var(--color-mute-2)]">
                    Off = the pilot parks at the final review and waits for you to pull the trigger.
                  </span>
                </span>
                <Toggle value={criteria.autoSubmit} onChange={(v) => setCriteria({ autoSubmit: v })} />
              </label>
            </div>
          </div>

          <div className="panel p-4">
            <h2 className="text-sm font-semibold">Ground rules</h2>
            <ul className="mt-2 space-y-2 text-[11px] leading-relaxed text-[var(--color-mute)]">
              <li className="flex gap-2">
                <span className="text-[var(--color-you)]">◆</span> Salary, availability, work authorisation and
                credentials are never invented. The pilot stops and asks.
              </li>
              <li className="flex gap-2">
                <span className="text-[var(--color-you)]">◆</span> Visual anti-bot walls are yours. A text model in a
                tab cannot see images, and blind guessing burns your account.
              </li>
              <li className="flex gap-2">
                <span className="text-[var(--color-pilot)]">◆</span> Everything the pilot does is written to an audit
                log you can read line by line.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ScoreDial({ score, verdict }: { score: number; verdict: JobMatch['verdict'] }) {
  const color =
    verdict === 'strong' ? 'var(--color-good)' : verdict === 'good' ? 'var(--color-pilot)' : 'var(--color-mute)';
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg viewBox="0 0 48 48" className="h-14 w-14 -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="var(--color-line)" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="mono text-sm font-semibold" style={{ color }}>
          {score}
        </span>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-[var(--color-mute)]">{label}</span>
        <span className="mono text-xs text-[var(--color-pilot)]">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 h-1 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-line)] accent-[var(--color-pilot)]"
      />
      {hint && <p className="mt-1 text-[10px] text-[var(--color-mute-2)]">{hint}</p>}
    </div>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cx(
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors',
        value ? 'border-[var(--color-pilot-dim)] bg-[var(--color-pilot)]' : 'border-[var(--color-line-2)] bg-[var(--color-panel-2)]',
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all',
          value ? 'left-[1.15rem]' : 'left-0.5',
        )}
      />
    </button>
  );
}
