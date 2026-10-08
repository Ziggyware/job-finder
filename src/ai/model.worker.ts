/**
 * Inference worker.
 *
 * Generation is compute-heavy and runs for seconds at a time; doing it on the
 * main thread makes the very UI that exists to *watch* the model stutter. This
 * worker owns the WebGPU context and streams tokens back, so the animations,
 * the log and the typewriter effect stay smooth.
 */
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};

// Lets the engine wrapper know the worker booted before it waits on a download.
self.postMessage({ kind: 'jobpilot-worker-ready' });
