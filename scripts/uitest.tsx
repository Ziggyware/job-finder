/**
 * Full-UI test in jsdom.
 *
 * Drives the real React app the way a person would: upload a resume (sample
 * button), start the pilot, then answer the human-in-the-loop prompts through
 * the actual DOM widgets — including typing into the generated text CAPTCHA and
 * clicking tiles in the image grid. Any component-level runtime error, missing
 * wiring, or broken promise chain shows up here.
 *
 *   node_modules/.bin/vite build --config vite.smoke.config.ts && node .smoke/uitest.mjs
 */
import { JSDOM } from 'jsdom';

// ---- environment first, imports after -------------------------------------
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'https://preview.example.com/',
});
const w = dom.window as unknown as Window & typeof globalThis;
const g = globalThis as any;
g.IS_REACT_ACT_ENVIRONMENT = true;
g.window = w;
g.document = w.document;
Object.defineProperty(g, 'navigator', { value: w.navigator, configurable: true, writable: true });
g.HTMLElement = w.HTMLElement;
g.HTMLInputElement = w.HTMLInputElement;
g.HTMLTextAreaElement = w.HTMLTextAreaElement;
g.HTMLCanvasElement = w.HTMLCanvasElement;
g.Element = w.Element;
g.Node = w.Node;
g.Event = w.Event;
g.MouseEvent = w.MouseEvent;
g.KeyboardEvent = w.KeyboardEvent;
g.PointerEvent = (w as any).PointerEvent ?? w.MouseEvent;
g.CustomEvent = w.CustomEvent;
g.getComputedStyle = w.getComputedStyle.bind(w);
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 8) as unknown as number;
g.cancelAnimationFrame = (id: number) => clearTimeout(id);

// jsdom has no 2D canvas. Give the CAPTCHA renderer a no-op context so the
// component's real drawing calls execute without a native canvas.
const noop = () => undefined;
const fakeCtx = {
  scale: noop, fillRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop,
  save: noop, restore: noop, translate: noop, rotate: noop, transform: noop, fillText: noop,
  measureText: () => ({ width: 10 }), clearRect: noop, closePath: noop, arc: noop, fill: noop,
  set fillStyle(_v: unknown) {}, set strokeStyle(_v: unknown) {}, set lineWidth(_v: unknown) {},
  set font(_v: unknown) {}, set textBaseline(_v: unknown) {}, set textAlign(_v: unknown) {},
};
(w.HTMLCanvasElement.prototype as any).getContext = () => fakeCtx;

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: App } = await import('../src/App');
const { useStore } = await import('../src/store');
const { pilot } = await import('../src/agent/pilot');

const act = (React as any).act as (cb: () => void | Promise<void>) => Promise<void>;

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`, extra === undefined ? '' : JSON.stringify(extra));
  }
};

const settle = async (ms = 40) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

async function waitFor(label: string, pred: () => boolean, timeoutMs = 25_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await settle(50);
  }
  console.log(`    (timeout waiting for ${label})`);
  return false;
}

const text = () => w.document.body.textContent ?? '';
const buttons = () => [...w.document.querySelectorAll('button')] as HTMLButtonElement[];
const clickText = (needle: string, root: ParentNode = w.document.body) => {
  const el = ([...root.querySelectorAll('button')] as HTMLButtonElement[]).find((b) =>
    (b.textContent ?? '').includes(needle),
  );
  if (!el) return false;
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  return true;
};

/** Set a controlled input's value the way React expects. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof w.HTMLTextAreaElement ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
}

/** Find the task card (the panel containing this prompt) and act inside it. */
function cardFor(prompt: string): HTMLElement | null {
  const nodes = ([...w.document.querySelectorAll('div')] as HTMLElement[]).filter(
    (n) =>
      typeof n.className === 'string' &&
      n.className.includes('panel') &&
      (n.textContent ?? '').includes(prompt.slice(0, 40)) &&
      n.querySelector('button, textarea, input'),
  );
  // the task card is the smallest such panel — the log panel also matches
  return nodes.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))[0] ?? null;
}

const realError = console.error;
console.error = (...args: unknown[]) => {
  const first = String(args[0] ?? '');
  if (first.includes('not wrapped in act') || first.includes('not configured to support act')) return;
  realError(...args);
};

console.log('\nUI: boot');
const container = w.document.getElementById('root')!;
const root = createRoot(container);
await act(async () => {
  root.render(React.createElement(App));
});
await settle(120);
check('app renders the upload stage', text().includes('Start with your resume'));
check('brand present', text().includes('JobPilot'));
check('model pill visible', text().includes('no WebGPU') || text().includes('no model') || text().includes('model'));

console.log('\nUI: sample resume → briefing');
check('sample button clicked', clickText('Try the sample résumé'));
const gotBriefing = await waitFor('briefing tab', () => text().includes('Run order') && text().includes('Briefing'));
check('briefing renders after parse', gotBriefing);
const stProfile = useStore.getState().profile;
check('store holds parsed profile', !!stProfile && stProfile.skills.length > 5, stProfile?.name);
const { JOBS } = await import('../src/data/jobs');
check('store ranked every posting', useStore.getState().matches.length === JOBS.length, useStore.getState().matches.length);
check('auto-select queued jobs', useStore.getState().selectedJobIds.length > 0, useStore.getState().selectedJobIds.length);
check('knockout posting is excluded from selection',
  !useStore.getState().selectedJobIds.includes('j-021'),
  useStore.getState().selectedJobIds.filter((i) => i.startsWith('j-02')));
check('degraded mode is stated in the log',
  useStore.getState().logs.some((l) => /no local model loaded/i.test(l.text)),
  useStore.getState().logs.map((l) => l.text.slice(0, 40)));

console.log('\nUI: start the pilot and answer everything it parks on');
useStore.getState().setCriteria({ maxApplications: 3, minScore: 55, humanCheckTimeoutMs: 30_000 });
check('start button clicked', clickText('Start pilot'));
const started = await waitFor('run board', () => text().includes('FLEET') && text().includes('AUDIT LOG'), 15_000);
check('run board renders', started);

// Answer pending work through the DOM, exactly like a person would.
let hostileLoops = 0;
const answeredIds = new Set<string>();
while (useStore.getState().phase === 'running' || useStore.getState().pending.length) {
  await settle(120);
  hostileLoops++;
  if (hostileLoops > 900) break;
  const pending = useStore.getState().pending;
  if (!pending.length) continue;
  for (const task of pending) {
    if (answeredIds.has(task.id)) continue;
    const prompt = task.question ?? task.challengePrompt ?? '';
    const card = cardFor(prompt);
    if (process.env.UIDEBUG) {
      console.log(`    [debug] task kind=${task.kind} challenge=${task.challenge} gate=${task.gate}`);
      console.log(`    [debug] prompt=${prompt.slice(0, 60)}`);
      console.log(`    [debug] card=${card ? 'found' : 'MISSING'}`);
      if (card) {
        const btns = [...card.querySelectorAll('button')].map((b) => `${b.textContent?.trim().slice(0, 22)}${b.disabled ? '[disabled]' : ''}`);
        console.log(`    [debug] card buttons: ${JSON.stringify(btns)}`);
        const f = card.querySelector('textarea, input');
        console.log(`    [debug] field: ${f ? (f as HTMLInputElement).value || '(empty)' : 'none'}`);
      } else {
        console.log(`    [debug] panels: ${JSON.stringify([...document.querySelectorAll('div')].filter(d => d.className.includes('panel')).map(d => (d.textContent||'').slice(0,50)))}`);
      }
    }

    if (task.gate === 'submit') {
      // The final review button lives in its own panel; find it globally.
      if (clickText('Approve & submit')) answeredIds.add(task.id);
      continue;
    }
    if (task.challenge === 'text-image') {
      const input = card?.querySelector('input') as HTMLInputElement | null;
      if (!input || !task.expected) continue;
      setValue(input, task.expected);
      await settle(16);
      if (clickText('Verify', card!)) answeredIds.add(task.id);
      continue;
    }
    if (task.challenge === 'select-image' && task.tiles && card) {
      const tiles = [...card.querySelectorAll('button')].filter((b) =>
        (b.textContent ?? '').match(/[\u{1F300}-\u{1FAFF}]/u),
      );
      task.tiles.forEach((t, i) => {
        if (t.correct && tiles[i]) tiles[i].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      });
      await settle(16);
      if (clickText('Submit selection', card)) answeredIds.add(task.id);
      continue;
    }
    if (task.challenge === 'slider') {
      // Pointer maths on a jsdom layout-less track is not meaningful; the
      // puzzle's own solve path is exercised through the pilot's API instead.
      pilot.answerPending(task.id, 'puzzle solved');
      answeredIds.add(task.id);
      continue;
    }
    // plain question / sensitive field
    const field = (card?.querySelector('textarea') ?? card?.querySelector('input')) as
      | HTMLTextAreaElement
      | HTMLInputElement
      | null;
    if (!field) continue;
    setValue(field, task.suggestion ?? 'Available in four weeks — authorised to work here.');
    await settle(16);
    if (clickText('Send to pilot', card!)) answeredIds.add(task.id);
  }
}

await waitFor('run completion', () => useStore.getState().phase !== 'running', 30_000);
const apps = useStore.getState().applications;
const submitted = apps.filter((a) => a.status === 'submitted');
console.log(
  `    · ${apps.length} applications · ${submitted.length} submitted · ${answeredIds.size} answered via the UI · phase ${useStore.getState().phase}`,
);
check('applications were created', apps.length >= 2, apps.length);
check('human answered at least one prompt through the UI', answeredIds.size >= 2, answeredIds.size);
check('submissions completed', submitted.length >= 1, submitted.length);
check('board shows a submission', /Submitted/.test(text()));
check('board shows receipts', submitted.some((a) => !!a.confirmationId));
check('no task left dangling', useStore.getState().pending.length === 0);
check('log narrates the run', useStore.getState().logs.filter((l) => l.level === 'human').length >= 2);

console.log('\nUI: ask the pilot (no model → grounded fallback)');
check('chat opened', clickText('Ask the pilot'));
await settle(60);
check('suggestion chips render', text().includes('How many applications went out?'));
check('suggestion clicked', clickText('How many applications went out?'));
await settle(700);
check('assistant answered from run state', /submitted so far/i.test(text()));

console.log('\nUI: model panel');
check('model pill opens the panel', clickText('· model'));
await settle(150);
check('panel explains the free-model story', text().includes('Local model') && text().includes('no API key'));
check('recommended models listed', text().includes('Llama 3.2 1B') && text().includes('Qwen2.5 1.5B'));
check('download sizes shown', /~\d+ MB download/.test(text()));
check('panel closes', clickText('✕'));
await settle(80);
check('panel is gone', !text().includes('Why not a hosted AI API?'));

console.log('\nUI: pause / resume controls');
useStore.getState().resetRun();
useStore.getState().setCriteria({ maxApplications: 1 });
check('restart run', clickText('Start pilot'));
await waitFor('run board again', () => text().includes('FLEET'), 10_000);
await settle(600);
check('pause button present', clickText('⏸ Pause'));
await settle(200);
check('phase is paused', useStore.getState().phase === 'paused');
check('resume button appears', clickText('▶ Resume'));
await settle(200);
check(
  'resume clears the paused state',
  ['running', 'finished'].includes(useStore.getState().phase),
  useStore.getState().phase,
);
check('stop works', clickText('⏹ Stop'));
await settle(300);
check('phase is stopped', useStore.getState().phase === 'stopped');

await act(async () => {
  root.unmount();
});

console.log(`\n${fail === 0 ? '✅' : '❌'} UI: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
