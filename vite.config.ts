import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The preview proxy serves the app from a *.e2b.app origin, so the dev server
// must accept any Host header and not lock down CORS.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    cors: true,
    // No COOP/COEP here on purpose: WebLLM and pdf.js need no cross-origin
    // isolation, and adding it would only restrict third-party fetches
    // (model weights come from huggingface.co over plain CORS).
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    cors: true,
  },
  worker: { format: 'es' },
  build: { target: 'esnext', chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@mlc-ai/web-llm', 'pdfjs-dist'] },
});
