import { useEffect, useState } from 'react';
import { useStore } from './store';
import { pilot } from './agent/pilot';
import { ai } from './ai/instance';
import ResumeStage from './components/ResumeStage';
import BriefingStage from './components/BriefingStage';
import RunStage from './components/RunStage';
import ModelPanel, { useEngineBridge, RECOMMENDED } from './components/ModelPanel';
import AskPilot from './components/AskPilot';
import { cx } from './lib/util';

type Tab = 'resume' | 'briefing' | 'run';

export default function App() {
  useEngineBridge();
  const [tab, setTab] = useState<Tab>('resume');
  const [modelsOpen, setModelsOpen] = useState(false);
  const [nudgedLoad, setNudgedLoad] = useState(false);

  const profile = useStore((s) => s.profile);
  const applications = useStore((s) => s.applications);
  const matches = useStore((s) => s.matches);
  const engine = useStore((s) => s.engine);
  const phase = useStore((s) => s.phase);
  const pending = useStore((s) => s.pending);
  const selectedJobIds = useStore((s) => s.selectedJobIds);
  const criteria = useStore((s) => s.criteria);
  const runnable = selectedJobIds.filter((id) => {
    const m = matches.find((x) => x.jobId === id);
    return !!m && m.score >= criteria.minScore;
  }).length;

  // First run: show the model panel once a resume exists, so the download can
  // happen while the user reads the briefing.
  useEffect(() => {
    if (profile && !nudgedLoad && engine.state !== 'ready' && engine.state !== 'unsupported') {
      setNudgedLoad(true);
      setModelsOpen(true);
    }
  }, [profile, nudgedLoad, engine.state]);

  useEffect(() => {
    if (!profile) setTab('resume');
    else if (applications.length) setTab('run');
    else setTab('briefing');
  }, [profile, applications.length]);

  // Warn before a reload nukes an in-flight run.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pilot.isRunning) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const enginePill = () => {
    switch (engine.state) {
      case 'ready':
        return { text: `local model ready · ${engine.tokensPerSec ? `${engine.tokensPerSec} tok/s · ` : ''}free`, tone: 'good' as const };
      case 'generating':
        return { text: `generating on your GPU${engine.tokensPerSec ? ` · ${engine.tokensPerSec} tok/s` : ''}`, tone: 'pilot' as const };
      case 'downloading':
      case 'loading':
        return { text: `downloading model · ${Math.round(engine.progress * 100)}%`, tone: 'pilot' as const };
      case 'unsupported':
        return { text: 'no WebGPU · heuristic mode', tone: 'you' as const };
      case 'error':
        return { text: 'model error', tone: 'bad' as const };
      default:
        return { text: 'no model loaded', tone: 'mute' as const };
    }
  };
  const pill = enginePill();
  const pillColor = {
    good: 'var(--color-good)',
    pilot: 'var(--color-pilot)',
    you: 'var(--color-you)',
    bad: 'var(--color-bad)',
    mute: 'var(--color-mute)',
  }[pill.tone];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-ink)_88%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-pilot-dim)] bg-gradient-to-b from-[#2a2008] to-[#171205] text-sm">
              🛫
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">JobPilot</div>
              <div className="text-[10px] text-[var(--color-mute-2)]">
                free on-device AI · no API key · nothing uploaded
              </div>
            </div>
          </div>

          <nav className="flex items-center gap-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] p-1">
            <TabButton active={tab === 'resume'} onClick={() => setTab('resume')} disabled={false}>
              1 · Resume
            </TabButton>
            <TabButton active={tab === 'briefing'} onClick={() => setTab('briefing')} disabled={!profile}>
              2 · Briefing{matches.length ? ` (${matches.length})` : ''}
            </TabButton>
            <TabButton active={tab === 'run'} onClick={() => setTab('run')} disabled={!applications.length}>
              3 · Run{applications.length ? ` (${applications.length})` : ''}
            </TabButton>
          </nav>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={() => setModelsOpen(true)}
              className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] px-3 py-1.5 text-[11px] hover:border-[var(--color-line-2)]"
            >
              <span
                className={cx('h-1.5 w-1.5 rounded-full', engine.state === 'generating' && 'animate-pulse')}
                style={{ background: pillColor }}
              />
              <span style={{ color: pillColor }}>{pill.text}</span>
              <span className="text-[var(--color-mute-2)]">· model</span>
            </button>

            {(engine.state === 'ready' || engine.state === 'generating') && (
              <TempoControl />
            )}

            {pilot.isRunning ? (
              <div className="flex items-center gap-1.5">
                {phase === 'paused' ? (
                  <button className="btn btn-primary" onClick={() => pilot.resume()}>
                    ▶ Resume
                  </button>
                ) : (
                  <button className="btn" onClick={() => pilot.pause()}>
                    ⏸ Pause
                  </button>
                )}
                <button className="btn" onClick={() => pilot.stop()}>
                  ⏹ Stop
                </button>
              </div>
            ) : (
              <button
                className="btn btn-primary"
                disabled={!profile || runnable === 0}
                title={
                  !profile
                    ? 'Load a resume first'
                    : runnable === 0
                      ? `Nothing selected above your minimum score of ${criteria.minScore} — pick postings in Briefing`
                      : `Run ${Math.min(runnable, criteria.maxApplications)} application(s)`
                }
                onClick={() => {
                  const s = useStore.getState();
                  const queue = s.selectedJobIds
                    .map((id) => s.matches.find((m) => m.jobId === id))
                    .filter((m) => !!m && m.score >= s.criteria.minScore)
                    .sort((a, b) => (b as any).score - (a as any).score);
                  if (!queue.length) {
                    setTab('briefing');
                    s.log('warn', 'Pick at least one posting above your minimum score before starting the pilot.');
                    return;
                  }
                  s.resetRun();
                  setTab('run');
                  void pilot.run(ai.ready ? ai : null, queue as any, s.criteria, profile!);
                }}
              >
                ▶ Start pilot
              </button>
            )}
          </div>
        </div>

        {pending.length > 0 && tab !== 'run' && (
          <button
            onClick={() => setTab('run')}
            className="block w-full border-t border-[#43265c] bg-[#1a1128] px-4 py-2 text-center text-[11px] text-[var(--color-you)]"
          >
            ◆ The pilot is paused on {pending.length} item{pending.length > 1 ? 's' : ''} that need you — open the run board →
          </button>
        )}
      </header>

      <main>
        {tab === 'resume' && <ResumeStage />}
        {tab === 'briefing' && profile && <BriefingStage />}
        {tab === 'run' && <RunStage />}
      </main>

      <footer className="mx-auto max-w-[1600px] px-4 py-8 text-[10px] leading-relaxed text-[var(--color-mute-2)]">
        JobPilot is a demonstration. The job exchange, companies, portals and confirmation receipts are fictional and
        generated locally; no real employer, job board or ATS is contacted, and no real application is ever submitted.
        The AI is real: open-weight models executed in your browser by WebLLM (Apache-2.0) over WebGPU — no API key, no
        account, no per-token cost, and no resume ever leaves this tab.
        {engine.state === 'unsupported' && ' WebGPU is unavailable here, so matching and form-filling run on heuristics.'}
      </footer>

      {modelsOpen && <ModelPanel onClose={() => setModelsOpen(false)} />}
      <AskPilot />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all',
        active ? 'bg-[var(--color-panel-2)] text-[var(--color-fg)]' : 'text-[var(--color-mute-2)] hover:text-[var(--color-mute)]',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {children}
    </button>
  );
}

function TempoControl() {
  const [speed, setSpeed] = useState(pilot.speed);
  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] p-1">
      <span className="px-1.5 text-[10px] text-[var(--color-mute-2)]">tempo</span>
      {[1, 2, 4].map((s) => (
        <button
          key={s}
          onClick={() => {
            pilot.speed = s;
            setSpeed(s);
          }}
          className={cx(
            'rounded-md px-1.5 py-1 text-[10px] font-medium',
            speed === s ? 'bg-[var(--color-panel-2)] text-[var(--color-fg)]' : 'text-[var(--color-mute-2)]',
          )}
        >
          {s}×
        </button>
      ))}
    </div>
  );
}

export { RECOMMENDED };
