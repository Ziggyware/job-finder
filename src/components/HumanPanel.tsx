import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { pilot } from '../agent/pilot';
import { cx } from '../lib/util';
import type { PendingTask } from '../types';

// ---------------------------------------------------------------------------
// "Needs you" — the human-in-the-loop surface.
//
// Everything here is a real interaction, not a screenshot: the text CAPTCHA is
// drawn on a canvas with per-character distortion and noise, the image grid is
// validated against the tiles the portal expects, and the drag puzzle requires
// the piece to actually land in the gap. When a task is solved the pilot's
// promise resolves and the run continues.
// ---------------------------------------------------------------------------

export default function HumanPanel() {
  const pending = useStore((s) => s.pending);

  if (!pending.length) {
    return (
      <div className="panel p-3.5">
        <p className="text-[11px] leading-relaxed text-[var(--color-mute-2)]">
          Nothing needs you right now. The pilot only stops for things it genuinely should not decide alone — salary,
          availability, legal declarations, and visual anti-bot walls.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {pending.map((t) => (
        <TaskCard key={t.id} task={t} />
      ))}
    </div>
  );
}

function TaskCard({ task }: { task: PendingTask }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);

  const answer = (v: string) => {
    setSolved(true);
    pilot.answerPending(task.id, v);
  };

  useEffect(() => {
    const t = setTimeout(() => setValue(task.suggestion ?? ''), 0);
    return () => clearTimeout(t);
  }, [task.id, task.suggestion]);

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="chip border-[#43265c] text-[var(--color-you)]">
            {task.gate === 'submit' ? 'final review' : task.kind === 'human-check' ? 'anti-bot wall' : 'your call'}
          </span>
          <span className="truncate text-[10px] text-[var(--color-mute-2)]">
            {task.jobTitle} · {task.company}
          </span>
        </div>
      </div>
      <button className="btn btn-ghost shrink-0 text-[10px]" onClick={() => pilot.skipPending(task.id)}>
        skip
      </button>
    </div>
  );

  if (solved) {
    return (
      <div className="panel border-[#1d4d3a] p-3.5">
        {header}
        <p className="mt-2 text-xs text-[var(--color-good)]">
          Sent back to the pilot. It picks up exactly where it stopped.
        </p>
      </div>
    );
  }

  // ---- final review gate --------------------------------------------------
  if (task.gate === 'submit') {
    return (
      <div className="panel border-[#43265c] p-3.5">
        {header}
        <p className="mt-2.5 text-xs leading-relaxed">{task.question}</p>
        {task.suggestion && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-mute-2)]">{task.suggestion}</p>
        )}
        <div className="mt-3 flex gap-2">
          <button className="btn btn-you flex-1" onClick={() => answer('approved')}>
            ✓ Approve &amp; submit
          </button>
          <button className="btn" onClick={() => pilot.skipPending(task.id)}>
            Leave unsent
          </button>
        </div>
      </div>
    );
  }

  // ---- a question ---------------------------------------------------------
  if (task.kind === 'question' || (!task.challenge && task.question)) {
    return (
      <div className="panel border-[#43265c] p-3.5">
        {header}
        <p className="mt-2.5 text-xs leading-relaxed">{task.question}</p>
        {task.reason && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-you)]">Why you: {task.reason}</p>
        )}
        {task.suggestion && (
          <button
            className="mono mt-2 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-2)] p-2 text-left text-[11px] leading-relaxed text-[var(--color-mute)] hover:border-[var(--color-line-2)]"
            onClick={() => setValue(task.suggestion!)}
          >
            <span className="text-[var(--color-pilot)]">draft → </span>
            {task.suggestion}
            <span className="mt-1 block text-[9px] text-[var(--color-mute-2)]">click to use this draft</span>
          </button>
        )}
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={2}
          placeholder="Your answer — the pilot will paste it verbatim"
          className="mt-2 w-full resize-y rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] p-2 text-xs leading-relaxed outline-none focus:border-[var(--color-you)]"
        />
        <div className="mt-2 flex gap-2">
          <button className="btn btn-you flex-1" disabled={!value.trim()} onClick={() => answer(value.trim())}>
            Send to pilot
          </button>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-mute-2)]">
          Leaving this blank and skipping means the pilot abandons the application rather than submitting a guess.
        </p>
      </div>
    );
  }

  // ---- anti-bot checks ----------------------------------------------------
  return (
    <div className="panel border-[#43265c] p-3.5">
      {header}
      <p className="mt-2.5 text-xs leading-relaxed">{task.challengePrompt}</p>
      {task.reason && <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-you)]">Why you: {task.reason}</p>}

      <div className="mt-3">
        {task.challenge === 'text-image' && (
          <TextCaptcha
            expected={task.expected ?? ''}
            onSubmit={answer}
            onFail={() => setError('That is not what the image says. Try again.')}
            error={error}
          />
        )}
        {task.challenge === 'select-image' && task.tiles && (
          <ImageGrid
            tiles={task.tiles}
            onSubmit={answer}
            onFail={() => setError('Not quite — the portal rejected that selection.')}
            error={error}
          />
        )}
        {task.challenge === 'slider' && <DragPuzzle onSubmit={answer} />}
        {task.challenge === 'checkbox' && (
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--color-line-2)] bg-[var(--color-ink-2)] p-3">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-you)]"
              onChange={(e) => {
                if (e.target.checked) setTimeout(() => answer('checked'), 350);
              }}
            />
            <span className="text-xs">I am not a robot</span>
          </label>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distorted-text CAPTCHA, drawn for real on a canvas.
// ---------------------------------------------------------------------------

function TextCaptcha({
  expected,
  onSubmit,
  onFail,
  error,
}: {
  expected: string;
  onSubmit: (v: string) => void;
  onFail: () => void;
  error: string | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [input, setInput] = useState('');

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = 260;
    const h = 84;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#e9e3d6';
    ctx.fillRect(0, 0, w, h);

    // Specks
    for (let i = 0; i < 240; i++) {
      ctx.fillStyle = `rgba(${60 + Math.random() * 80},${60 + Math.random() * 60},${60 + Math.random() * 60},${0.15 + Math.random() * 0.35})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random(), 1 + Math.random());
    }
    // Wavy interference lines
    ctx.strokeStyle = 'rgba(70,70,70,0.5)';
    for (let l = 0; l < 4; l++) {
      ctx.beginPath();
      ctx.lineWidth = 0.8 + Math.random();
      const y0 = Math.random() * h;
      ctx.moveTo(0, y0);
      for (let x = 0; x <= w; x += 12) {
        ctx.lineTo(x, y0 + Math.sin(x / 26 + l) * (5 + Math.random() * 6));
      }
      ctx.stroke();
    }
    // Glyphs, each with its own rotation/baseline/skew
    const chars = expected.split('');
    const slot = (w - 34) / Math.max(chars.length, 1);
    ctx.textBaseline = 'middle';
    chars.forEach((ch, i) => {
      const size = 30 + Math.random() * 10;
      ctx.save();
      const x = 20 + i * slot + Math.random() * 3;
      const y = h / 2 + (Math.random() - 0.5) * 10;
      ctx.translate(x, y);
      ctx.rotate((Math.random() - 0.5) * 0.55);
      ctx.transform(1, (Math.random() - 0.5) * 0.32, 0, 1, 0, 0);
      ctx.font = `700 ${size}px ui-monospace, monospace`;
      ctx.fillStyle = `hsl(${Math.random() * 40 + 190}, 25%, ${18 + Math.random() * 18}%)`;
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    });
    // Slash through the text, like the real thing
    ctx.strokeStyle = 'rgba(90,90,90,0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(10, h - 12);
    ctx.lineTo(w - 12, 14);
    ctx.stroke();
  }, [expected]);

  const submit = () => {
    if (input.trim().toLowerCase() === expected.trim().toLowerCase()) onSubmit(input.trim());
    else onFail();
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <canvas ref={ref} className="rounded-lg border border-[var(--color-line-2)]" />
        <button className="btn btn-ghost text-[10px]" onClick={() => setInput('')} type="button">
          ↻ clear
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Type the characters"
          className="mono min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1.5 text-xs outline-none focus:border-[var(--color-you)]"
        />
        <button className="btn btn-you" onClick={submit} disabled={!input.trim()}>
          Verify
        </button>
      </div>
      {error && <p className="mt-1.5 text-[10px] text-[#e59a9a]">{error}</p>}
      <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-mute-2)]">
        Case-insensitive — you are reading a locally drawn canvas, nothing was fetched.
      </p>
    </div>
  );
}

function ImageGrid({
  tiles,
  onSubmit,
  onFail,
  error,
}: {
  tiles: { glyph: string; label: string; correct: boolean }[];
  onSubmit: (v: string) => void;
  onFail: () => void;
  error: string | null;
}) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setPicked((s) => {
      const next = new Set(s);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  const submit = () => {
    const chosen = [...picked];
    const correct = new Set(tiles.map((t, i) => (t.correct ? i : -1)).filter((i) => i >= 0));
    const ok = chosen.length === correct.size && chosen.every((i) => correct.has(i));
    if (ok) onSubmit(`selected ${correct.size} tile(s)`);
    else onFail();
  };
  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5">
        {tiles.map((t, i) => (
          <button
            key={i}
            onClick={() => toggle(i)}
            className={cx(
              'relative flex h-16 items-center justify-center rounded-lg border text-2xl transition-all',
              picked.has(i)
                ? 'border-[var(--color-you)] bg-[#221633]'
                : 'border-[var(--color-line)] bg-[#20242c] hover:border-[var(--color-line-2)]',
            )}
          >
            <span style={{ filter: 'saturate(0.85)' }}>{t.glyph}</span>
            {picked.has(i) && (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-you)] text-[9px] font-bold text-black">
                ✓
              </span>
            )}
          </button>
        ))}
      </div>
      {error && <p className="mt-1.5 text-[10px] text-[#e59a9a]">{error}</p>}
      <button className="btn btn-you mt-2 w-full" onClick={submit} disabled={!picked.size}>
        Submit selection ({picked.size})
      </button>
      <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-mute-2)]">
        Tiles are rendered locally. This is the class of check a text model cannot do — which is why it comes to you.
      </p>
    </div>
  );
}

/** Drag the piece into the gap. Real pointer maths, small tolerance. */
function DragPuzzle({ onSubmit }: { onSubmit: (v: string) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(0.08);
  const [dragging, setDragging] = useState(false);
  const [solved, setSolved] = useState(false);
  const target = useRef(0.55 + Math.random() * 0.3);
  const gapLeft = target.current * 100;

  const onMove = (clientX: number) => {
    const el = trackRef.current;
    if (!el || solved) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setPos(ratio);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => onMove(e.clientX);
    const up = () => {
      setDragging(false);
      setPos((p) => {
        if (Math.abs(p - target.current) < 0.055) {
          setSolved(true);
          onSubmit('puzzle solved');
          return target.current;
        }
        return 0.08;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, onSubmit]);

  return (
    <div>
      <div
        ref={trackRef}
        className="relative h-14 touch-none select-none overflow-hidden rounded-lg border border-[var(--color-line-2)] bg-[#20242c]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(115deg, #232833 0 12px, #1d222b 12px 24px)',
        }}
      >
        <div
          className="absolute inset-y-0 w-[38px] rounded-md border-2 border-dashed border-white/25"
          style={{ left: `calc(${gapLeft}% - 19px)` }}
        />
        <div
          className={cx(
            'absolute inset-y-1 flex w-[38px] cursor-grab items-center justify-center rounded-md border-2 text-lg',
            solved
              ? 'border-[var(--color-good)] bg-[#16302a]'
              : 'border-[var(--color-you)] bg-[#2a1a3d]',
            dragging && 'cursor-grabbing',
          )}
          style={{ left: `calc(${pos * 100}% - 19px)`, transition: dragging ? 'none' : 'left 0.25s ease' }}
          onPointerDown={() => setDragging(true)}
        >
          🧩
        </div>
      </div>
      <p className={cx('mt-1.5 text-[10px]', solved ? 'text-[var(--color-good)]' : 'text-[var(--color-mute-2)]')}>
        {solved ? 'Piece seated. Checkpoint cleared.' : 'Drag the puzzle piece into the dashed gap, then release.'}
      </p>
    </div>
  );
}
