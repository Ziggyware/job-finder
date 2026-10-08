import { useEffect, useState } from 'react';
import { useStore } from './store';
import ResumeStage from './components/ResumeStage';
import BriefingStage from './components/BriefingStage';
import ModelPanel, { useEngineBridge, RECOMMENDED } from './components/ModelPanel';
import { cx } from './lib/util';

type Tab = 'resume' | 'briefing';

export default function App() {
  useEngineBridge();
  const profile = useStore((s) => s.profile);
  const engine = useStore((s) => s.engine);
  const [tab, setTab] = useState<Tab>(profile ? 'briefing' : 'resume');
  const [modelsOpen, setModelsOpen] = useState(false);

  useEffect(() => {
    if (!profile) setTab('resume');
  }, [profile]);

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
              <div className="text-lg font-semibold tracking-tight">JobPilot</div>
              <div className="text-sm text-[var(--color-mute-2)]">
                {profile ? profile.name : 'Resume stays on this device'}
              </div>
            </div>
          </div>

          <nav className="flex items-center gap-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] p-1">
            <TabButton active={tab === 'resume'} onClick={() => setTab('resume')} disabled={false}>
              1 · Resume
            </TabButton>
            <TabButton active={tab === 'briefing'} onClick={() => setTab('briefing')} disabled={!profile}>
              2 · Search & apply
            </TabButton>
          </nav>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={() => setModelsOpen(true)}
              className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] px-3 py-1.5 text-sm hover:border-[var(--color-line-2)]"
            >
              <span
                className={cx('h-1.5 w-1.5 rounded-full', engine.state === 'generating' && 'animate-pulse')}
                style={{ background: pillColor }}
              />
              <span style={{ color: pillColor }}>{pill.text}</span>
              <span className="text-[var(--color-mute-2)]">· model</span>
            </button>
          </div>
        </div>
      </header>

      <main>
        {tab === 'resume' && <ResumeStage onContinue={profile ? () => setTab('briefing') : undefined} />}
        {tab === 'briefing' && profile && <BriefingStage />}
      </main>

      <footer className="mx-auto max-w-[1600px] px-4 py-8 text-sm leading-relaxed text-[var(--color-mute-2)]">
        JobPilot parses your resume on this device, opens real searches on LinkedIn, Indeed, Glassdoor,
        Google Jobs and other boards, and helps fill those application screens. It does not list fake
        jobs and it does not submit applications for you. Open-weight models run in the browser via
        WebLLM — no API key, no account, no resume upload.
        {engine.state === 'unsupported' && ' WebGPU is unavailable here, so drafts use templates instead of a local model.'}
      </footer>

      {modelsOpen && <ModelPanel onClose={() => setModelsOpen(false)} />}
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
        'rounded-lg px-3 py-1.5 text-base font-medium transition-all',
        active ? 'bg-[var(--color-panel-2)] text-[var(--color-fg)]' : 'text-[var(--color-mute-2)] hover:text-[var(--color-mute)]',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {children}
    </button>
  );
}

export { RECOMMENDED };
