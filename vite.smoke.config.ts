import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Builds scripts/uitest.tsx (the jsdom UI suite) for Node. The pdf.js *worker*
// import is browser-only, so it is aliased to a stub here.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?worker$/,
        replacement: path.resolve(__dirname, 'scripts/worker-stub.js'),
      },
    ],
  },
  // Keep Node-only deps external: jsdom and React must be the real modules (a
  // CJS copy inlined into an ESM bundle with top-level await is a syntax error).
  ssr: { noExternal: true, external: ['jsdom', 'react', 'react-dom', 'react-dom/client', 'react-dom/server'] },
  build: {
    ssr: 'scripts/uitest.tsx',
    outDir: '.smoke',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: { output: { entryFileNames: '[name].mjs' } },
  },
});
