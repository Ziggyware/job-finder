import { LocalAI } from './engine';

/**
 * One engine per tab. WebLLM holds GPU memory, so we never instantiate twice —
 * React StrictMode double-mounts, hot reloads, and route changes all share this.
 */
export const ai = new LocalAI();
