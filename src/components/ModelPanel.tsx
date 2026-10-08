import { useEffect, useMemo, useState } from 'react';
import { ai } from '../ai/instance';
import { useStore } from '../store';
import { cx } from '../lib/util';

// ---------------------------------------------------------------------------
// Model manager.
//
// The whole reason this app is free: the model runs on the user's GPU. So the
// download is the one cost, and it is a download — not a subscription. This
// panel is deliberate about size, cache state, and what happens without WebGPU.
// ---------------------------------------------------------------------------

export const RECOMMENDED: { id: string; label: string; note: string; sizeMB: number }[] = [
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    label: 'SmolLM2 360M',
    note: 'Tiny and instant. Good for field-filling and short drafts; thin on reasoning.',
    sizeMB: 376,
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 0.5B',
    note: 'Best size-to-coherence ratio at the very small end.',
    sizeMB: 945,
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B',
    note: 'Recommended. Reliable instruction following for cover letters and form answers.',
    sizeMB: 879,
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 1.5B',
    note: 'Noticeably better reasoning. Wants a decent discrete or Apple-silicon GPU.',
    sizeMB: 1630,
  },
  {
    id: 'Qwen3-1.7B-q4f16_1-MLC',
    label: 'Qwen3 1.7B',
    note: 'Newest small model in the catalog. Strongest judgement of the small tier.',
    sizeMB: 2037,
  },
  {
    id: 'Llama-3.1-8B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.1 8B',
    note: 'Frontier-quality drafts, but wants ~8GB of free VRAM and a 5GB download.',
    sizeMB: 5001,
  },
];

export function useEngineBridge() {
  const setEngine = useStore((s) => s.setEngine);
  useEffect(() => {
    const off = ai.onStatus((s) => setEngine(s));
    void ai.probe();
    return off;
  }, [setEngine]);
}

export default function ModelPanel({ onClose }: { onClose: () => void }) {
  const engine = useStore((s) => s.engine);
  const [cached, setCached] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const [catalogue, setCatalogue] = useState<{ id: string; vram: number }[]>([]);

  useEffect(() => {
    void ai.cachedModels().then(setCached).catch(() => setCached([]));
    void ai.modelCatalogue().then((list) => {
      setCatalogue(
        (list ?? [])
          .filter((m: any) => /q4f16_1-MLC$/.test(m.model_id) && !/embed/i.test(m.model_id))
          .map((m: any) => ({ id: m.model_id as string, vram: (m.vram_required_MB ?? 0) as number }))
          .sort((a, b) => a.vram - b.vram),
      );
    }).catch(() => setCatalogue([]));
  }, []);
  useEffect(() => {
    if (engine.state === 'ready' || engine.state === 'error') void ai.cachedModels().then(setCached).catch(() => undefined);
  }, [engine.state]);

  const allModels = useMemo(() => {
    const list = catalogue
      .filter((m: any) => /q4f16_1-MLC$/.test(m.model_id) && !/embed/i.test(m.model_id))
    // de-dupe family variants that only differ by context length
    const seen = new Set<string>();
    return list.filter((m) => {
      const key = m.id.replace(/-1k$/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [catalogue]);

  const load = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await ai.load(id);
      setCached(await ai.cachedModels());
    } finally {
      setBusy(false);
    }
  };

  const state = engine.state;
  const progressPct = Math.round((engine.progress || 0) * 100);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="panel h-full w-full max-w-lg overflow-y-auto rounded-none border-y-0 border-r-0 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Local model</h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-mute)]">
              Models are downloaded once from Hugging Face and cached by your browser. Inference runs on your GPU via
              WebGPU — no API key, no account, no server, no per-request cost. Ever.
            </p>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        {state === 'unsupported' && (
          <div className="mb-4 rounded-xl border border-[var(--color-pilot-dim)] bg-[#1b1405] p-3 text-xs leading-relaxed text-[#ffd88a]">
            <strong className="font-semibold">Heuristic mode.</strong> {engine.progressText}
          </div>
        )}

        {(state === 'downloading' || state === 'loading') && (
          <div className="mb-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="mono text-[var(--color-pilot)]">downloading weights…</span>
              <span className="mono text-[var(--color-mute)]">{progressPct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]">
              <div
                className="shine h-full rounded-full bg-[var(--color-pilot)] transition-all duration-300"
                style={{ width: `${Math.max(progressPct, 2)}%` }}
              />
            </div>
            <p className="mono mt-2 line-clamp-2 text-[10px] text-[var(--color-mute-2)]">{engine.progressText}</p>
          </div>
        )}

        {state === 'error' && (
          <div className="mb-4 rounded-xl border border-[#5a2626] bg-[#1d0f0f] p-3 text-xs leading-relaxed text-[#ffb4b4]">
            <strong className="font-semibold">Could not load that model.</strong>
            <p className="mono mt-1 break-words text-[10px] opacity-80">{engine.error}</p>
          </div>
        )}

        {ai.ready && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] p-3 text-xs">
            <div>
              <div className="font-medium text-[var(--color-good)]">
                ● loaded{ai.host === 'web-worker' ? ' in a web worker' : ai.host === 'main-thread' ? ' on the main thread' : ''}
              </div>
              <div className="mono mt-0.5 text-[10px] text-[var(--color-mute)]">{engine.modelId}</div>
              <div className="mono mt-0.5 text-[10px] text-[var(--color-mute-2)]">
                {engine.tokensPerSec ? `~${engine.tokensPerSec} tok/s · ` : ''}
                {ai.host === 'web-worker' ? 'UI stays smooth while it thinks' : 'inference shares the main thread'}
              </div>
            </div>
            <button className="btn" onClick={() => ai.unload()}>
              Release GPU memory
            </button>
          </div>
        )}

        <div className="space-y-2">
          {RECOMMENDED.map((m) => (
            <ModelRow
              key={m.id}
              id={m.id}
              title={m.label}
              note={m.note}
              sizeMB={m.sizeMB}
              cached={cached.includes(m.id)}
              active={engine.modelId === m.id}
              busy={busy}
              onLoad={() => load(m.id)}
            />
          ))}
        </div>

        <button className="btn btn-ghost mt-3 w-full" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Hide' : 'Show'} all {allModels.length} models in the catalog
        </button>

        {showAll && (
          <div className="mt-2 max-h-80 overflow-y-auto rounded-xl border border-[var(--color-line)]">
            {allModels.map((m) => (
              <button
                key={m.id}
                onClick={() => load(m.id)}
                disabled={busy || engine.modelId === m.id}
                className={cx(
                  'flex w-full items-center justify-between gap-3 border-b border-[var(--color-line)] px-3 py-2 text-left text-xs last:border-b-0 hover:bg-[var(--color-panel-2)]',
                  engine.modelId === m.id && 'bg-[var(--color-panel-2)]',
                )}
              >
                <span className="mono truncate">{m.id}</span>
                <span className="mono shrink-0 text-[10px] text-[var(--color-mute-2)]">
                  {cached.includes(m.id) ? 'cached · ' : ''}
                  {(m.vram / 1024).toFixed(1)} GB VRAM
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] p-3">
          <h3 className="text-xs font-semibold text-[var(--color-mute)]">Why not a hosted AI API?</h3>
          <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-[var(--color-mute-2)]">
            <li>
              Hosted free tiers need a key, an account, and a usage cap — and they read your resume on their servers.
            </li>
            <li>
              WebLLM downloads an open-weight model (Apache-2.0 engine, open-weight models) and runs it inside this tab.
              Nothing about your resume leaves this device, and there is nothing to meter.
            </li>
            <li>
              Cost of the whole stack: the electricity. That is what "completely free" has to mean.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function ModelRow({
  id,
  title,
  note,
  sizeMB,
  cached,
  active,
  busy,
  onLoad,
}: {
  id: string;
  title: string;
  note: string;
  sizeMB: number;
  cached: boolean;
  active: boolean;
  busy: boolean;
  onLoad: () => void;
}) {
  const engine = useStore((s) => s.engine);
  const isThis = engine.modelId === id;
  const downloading = isThis && (engine.state === 'downloading' || engine.state === 'loading');
  // The loaded model is not reloadable from its own row, and a download in progress cannot be re-clicked.
  const loadedAlready = active && engine.state === 'ready';
  return (
    <div
      className={cx(
        'card-hover rounded-xl border p-3',
        active ? 'border-[var(--color-pilot-dim)] bg-[#16130a]' : 'border-[var(--color-line)] bg-[var(--color-ink-2)]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{title}</span>
            {cached && <span className="chip text-[var(--color-good)]">cached</span>}
            {active && <span className="chip text-[var(--color-pilot)]">active</span>}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-mute)]">{note}</p>
          <p className="mono mt-1 text-[10px] text-[var(--color-mute-2)]">~{sizeMB} MB download</p>
        </div>
        <button
          className={cx('btn shrink-0', downloading && 'btn-primary')}
          onClick={onLoad}
          disabled={busy || downloading || loadedAlready}
        >
          {downloading ? `${Math.round(engine.progress * 100)}%` : cached ? 'Load' : 'Download'}
        </button>
      </div>
      {downloading && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--color-line)]">
          <div
            className="shine h-full rounded-full bg-[var(--color-pilot)]"
            style={{ width: `${Math.max(Math.round(engine.progress * 100), 2)}%` }}
          />
        </div>
      )}
    </div>
  );
}
