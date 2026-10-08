import type { EngineStatus } from '../types';

export type StatusListener = (s: EngineStatus) => void;

interface EngineHandle {
  engine: any;
  modelId: string;
}

const EMPTY: EngineStatus = {
  state: 'idle',
  backend: 'webllm',
  modelId: '',
  progress: 0,
  progressText: '',
};

export type EngineHost = 'web-worker' | 'main-thread';

type WebLLMModule = typeof import('@mlc-ai/web-llm');

/**
 * A single-slot, headless wrapper around WebLLM.
 *
 * WebLLM runs a *quantised open-weight LLM inside the browser tab* using
 * WebGPU. There is no API key, no account, no server, and no per-token cost —
 * the model files are downloaded once from Hugging Face and cached in the
 * browser's Cache Storage, so subsequent sessions start instantly and work
 * offline. That is what makes this app "completely free": the compute is the
 * user's own GPU.
 */
export class LocalAI {
  status: EngineStatus = { ...EMPTY };
  /** Whether inference is hosted off the main thread. */
  host: EngineHost | null = null;
  ready = false;
  unsupportedReason: string | null = null;

  private handle: EngineHandle | null = null;
  private listeners = new Set<StatusListener>();
  private queue: Promise<unknown> = Promise.resolve();
  private mod: WebLLMModule | null = null;
  private tokensEmitted = 0;
  private generationStart = 0;
  private loadChain: Promise<boolean> = Promise.resolve(true);
  private worker: Worker | null = null;
  private interruptRequested = false;

  onStatus(fn: StatusListener) {
    this.listeners.add(fn);
    fn(this.status);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(patch: Partial<EngineStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  /** Cheap capability probe — done before we talk anyone into a 600MB download. */
  async probe(): Promise<{ ok: boolean; reason?: string; adapter?: string }> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      const reason =
        'This browser has no WebGPU. JobPilot will run in heuristic mode (rule-based matching, no LLM). For full AI, use Chrome 113+, Edge 113+, Safari 26+, or Firefox 141+.';
      this.unsupportedReason = reason;
      this.set({ state: 'unsupported', progressText: reason });
      return { ok: false, reason };
    }
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (!adapter) {
        const reason = 'WebGPU is present but no GPU adapter was available (often a headless VM or a blocklisted driver). Running in heuristic mode instead.';
        this.unsupportedReason = reason;
        this.set({ state: 'unsupported', progressText: reason });
        return { ok: false, reason };
      }
      let desc = 'WebGPU adapter ready';
      try {
        const info = adapter.info ?? (await adapter.requestAdapterInfo?.());
        if (info) desc = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || desc;
      } catch {
        /* adapter info is optional in some implementations */
      }
      return { ok: true, adapter: desc };
    } catch (e: any) {
      const reason = `WebGPU probe failed: ${e?.message ?? e}. Running in heuristic mode.`;
      this.unsupportedReason = reason;
      this.set({ state: 'unsupported', progressText: reason });
      return { ok: false, reason };
    }
  }

  /**
   * The web-llm bundle is ~1MB of wasm glue and is only needed once the user
   * actually engages with a model, so it lives in its own chunk.
   */
  private async module(): Promise<WebLLMModule> {
    if (!this.mod) this.mod = await import('@mlc-ai/web-llm');
    return this.mod;
  }

  async modelCatalogue() {
    const mod = await this.module();
    return mod.prebuiltAppConfig.model_list;
  }

  async cachedModels(): Promise<string[]> {
    const mod = await this.module();
    const out: string[] = [];
    for (const m of mod.prebuiltAppConfig.model_list) {
      try {
        if (await mod.hasModelInCache(m.model_id)) out.push(m.model_id);
      } catch {
        /* ignore */
      }
    }
    return out;
  }

  /**
   * Download + initialise a model. Safe to call repeatedly: loads and unloads are
   * serialised on one chain, so overlapping calls (a double-click, or switching
   * model while one is still downloading) can never leave two engines holding GPU memory.
   */
  load(modelId: string): Promise<boolean> {
    const run = this.loadChain.then(() => this.doLoad(modelId));
    this.loadChain = run.catch(() => false);
    return run;
  }

  private async doLoad(modelId: string): Promise<boolean> {
    if (this.handle?.modelId === modelId && this.ready) return true;

    let mod: WebLLMModule;
    try {
      mod = await this.module();
    } catch (e: any) {
      this.set({
        state: 'error',
        error: String(e?.message ?? e),
        progressText: `Could not fetch the inference engine: ${e?.message ?? e}`,
      });
      return false;
    }

    const probe = await this.probe();
    if (!probe.ok) return false;

    // Release the previous model first, so its GPU memory is free before the new one allocates.
    await this.releaseHandle();

    this.set({
      state: 'downloading',
      modelId,
      progress: 0,
      progressText: `Preparing ${modelId}…`,
      tokensPerSec: undefined,
      error: undefined,
    });

    const onProgress = (report: any) => {
      const text: string = report?.text ?? '';
      const isLoad = /loading/i.test(text);
      this.set({
        state: isLoad ? 'loading' : 'downloading',
        progress: typeof report?.progress === 'number' ? report.progress : this.status.progress,
        progressText: text || this.status.progressText,
      });
    };

    const config = { initProgressCallback: onProgress, logLevel: 'WARN' } as any;
    let workerErr: unknown = null;
    try {
      let engine: any = null;

      // Preferred: a dedicated worker, so generation never blocks the UI.
      if (typeof Worker !== 'undefined') {
        let worker: Worker | null = null;
        try {
          worker = new Worker(new URL('./model.worker.ts', import.meta.url), { type: 'module' });
          engine = await mod.CreateWebWorkerMLCEngine(worker, modelId, config);
          this.worker = worker;
          this.host = 'web-worker';
        } catch (e) {
          // A worker that failed to initialise must not be left running (it may hold GPU buffers).
          worker?.terminate();
          workerErr = e;
          engine = null;
          this.host = null;
          console.warn('[jobpilot] worker engine unavailable, trying the main thread', e);
        }
      }

      if (!engine) {
        engine = await mod.CreateMLCEngine(modelId, config);
        this.host = 'main-thread';
      }

      this.handle = { engine, modelId };
      this.ready = true;
      this.set({
        state: 'ready',
        progress: 1,
        progressText: `${modelId} ready on your GPU${this.host === 'web-worker' ? ' (web worker)' : ''}.`,
      });
      return true;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      // The main-thread error is the one that matters (e.g. out of memory); keep the worker's too for diagnosis.
      const detail = workerErr ? ` (worker attempt: ${String((workerErr as any)?.message ?? workerErr)})` : '';
      this.set({
        state: 'error',
        error: msg + detail,
        progressText: `Could not load ${modelId}: ${msg}${detail}`,
      });
      return false;
    }
  }

  /** Ask the model to stop generating (used when the operator hits stop). */
  interrupt() {
    this.interruptRequested = true;
    try {
      const e: any = this.handle?.engine;
      if (typeof e?.interruptGenerate === 'function') e.interruptGenerate();
    } catch {
      /* not fatal */
    }
  }

  /** Release the loaded model (serialised after any load in progress). */
  unload(): void {
    this.loadChain = this.loadChain.then(
      () => this.releaseHandle().then(() => false),
      () => this.releaseHandle().then(() => false),
    );
  }

  /** Free the engine and its worker. Waits for an in-flight generation so GPU buffers are not pulled out from under it. */
  private async releaseHandle(): Promise<void> {
    if (!this.handle && !this.worker) return;
    this.interrupt();
    await this.queue.catch(() => undefined);
    const engine = this.handle?.engine;
    const worker = this.worker;
    this.handle = null;
    this.worker = null;
    this.ready = false;
    this.host = null;
    try {
      await engine?.unload?.();
    } catch {
      /* already gone */
    }
    worker?.terminate();
    this.set({ state: 'idle', progress: 0, progressText: 'Model released.' });
  }

  /** Run one completion. Calls are serialised — a GPU does one thing at a time. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  get busy() {
    return this.status.state === 'generating';
  }

  async complete(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    opts: { maxTokens?: number; temperature?: number; json?: boolean; seed?: number; onToken?: (t: string) => void } = {},
  ): Promise<string> {
    if (!this.handle) throw new Error('No model loaded');
    const engine = this.handle.engine;
    return this.enqueue(async () => {
      if (!this.handle || this.handle.engine !== engine) {
        throw new Error('The model was released before this request ran');
      }
      this.interruptRequested = false;
      this.tokensEmitted = 0;
      this.generationStart = performance.now();
      this.set({ state: 'generating' });
      try {
        const stream = await engine.chat.completions.create({
          messages,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: opts.maxTokens ?? 320,
          temperature: opts.temperature ?? 0.4,
          top_p: 0.9,
          seed: opts.seed,
          // WebLLM exposes OpenAI's structured-output field; small models do
          // better with an explicit JSON *hint in the prompt* than with a hard
          // grammar, so we only set this when the caller wants it.
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        } as any);

        let acc = '';
        for await (const chunk of stream as any) {
          const delta = chunk?.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            acc += delta;
            this.tokensEmitted += 1;
            opts.onToken?.(acc);
          }
        }
        // An interrupted reply is partial. Returning it as if complete would let a half-written
        // answer or a truncated JSON object reach the operator or the form.
        if (this.interruptRequested) throw new Error('Generation was interrupted');
        const secs = (performance.now() - this.generationStart) / 1000;
        if (secs > 0.5 && this.tokensEmitted > 4) {
          this.set({ tokensPerSec: +(this.tokensEmitted / secs).toFixed(1) });
        }
        this.set({ state: 'ready' });
        return acc.trim();
      } catch (e: any) {
        this.set({ state: 'ready', error: String(e?.message ?? e) });
        throw e;
      }
    });
  }

  /**
   * Ask for JSON and get back a parsed object, or null.
   *
   * Small models in browsers emit *nearly* valid JSON — trailing prose,
   * single quotes, unquoted keys, a trailing comma, markdown fences. We
   * repair all of that rather than throwing away an otherwise good answer.
   */
  async completeJSON<T>(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    opts: { maxTokens?: number; temperature?: number; seed?: number } = {},
  ): Promise<T | null> {
    const raw = await this.complete(messages, { ...opts, json: true, temperature: opts.temperature ?? 0.2 });
    return parseLooseJSON<T>(raw);
  }
}

/** Tolerant JSON recovery for model output. Exported for tests + reuse. */
export function parseLooseJSON<T>(raw: string): T | null {
  if (!raw) return null;
  let s = raw.trim();
  // Strip markdown fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const candidates: string[] = [s];

  // Widest balanced object / array in the string
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  const start = [firstObj, firstArr].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (start !== undefined) {
    const openCh = s[start];
    const closeCh = openCh === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === openCh) depth++;
      else if (c === closeCh) {
        depth--;
        if (depth === 0) {
          candidates.push(s.slice(start, i + 1));
          break;
        }
      }
    }
  }

  for (const candidate of candidates) {
    const attempts = [
      candidate,
      candidate.replace(/,\s*([}\]])/g, '$1'),
      candidate.replace(/,\s*([}\]])/g, '$1').replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":'),
      candidate
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":')
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"'),
    ];
    for (const attempt of attempts) {
      try {
        return JSON.parse(attempt) as T;
      } catch {
        /* try the next repair */
      }
    }
  }
  return null;
}
