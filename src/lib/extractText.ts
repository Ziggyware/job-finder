// ---------------------------------------------------------------------------
// Resume text extraction — runs entirely in the browser.
//
//   PDF   -> pdfjs-dist (worker bundled by Vite, no CDN, no server)
//   DOCX  -> unzip with fflate and read word/document.xml (no dependency on
//            a JSZip/mammoth-style stack; we only need the text runs)
//   TXT / MD / RTF -> straight read, with light RTF control-word stripping
//
// Nothing is uploaded. The file never leaves the tab.
// ---------------------------------------------------------------------------

import * as pdfjs from 'pdfjs-dist';
import { unzipSync, strFromU8 } from 'fflate';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { docxToText } from './docx';

let workerReady = false;
function ensurePdfWorker() {
  if (workerReady) return;
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  workerReady = true;
}

export interface ExtractResult {
  text: string;
  kind: 'pdf' | 'docx' | 'text';
  pages?: number;
  warnings: string[];
}

const RTF_ESCAPES: Record<string, string> = {
  par: '\n',
  line: '\n',
  tab: '\t',
  '\\{': '{',
  '\\}': '}',
  '\\\\': '\\',
};

function stripRtf(input: string): string {
  let out = input
    .replace(/\\'([0-9a-fA-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\{\\\*[^{}]*\}/g, '');
  for (const [k, v] of Object.entries(RTF_ESCAPES)) out = out.split(`\\${k}`).join(v);
  return out
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractResumeText(file: File): Promise<ExtractResult> {
  const warnings: string[] = [];
  const name = file.name.toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());

  // --- PDF -------------------------------------------------------------
  const looksPdf = name.endsWith('.pdf') || (buf[0] === 0x25 && buf[1] === 0x50);
  if (looksPdf) {
    ensurePdfWorker();
    const task = pdfjs.getDocument({ data: buf });
    const doc = await task.promise;
    const pages = doc.numPages;
    let text = '';
    try {
      for (let p = 1; p <= pages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        let lastY: number | null = null;
        for (const item of content.items as any[]) {
          if (typeof item.str !== 'string') continue;
          const y = item.transform?.[5];
          if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) text += '\n';
          text += item.str;
          lastY = y ?? lastY;
        }
        text += '\n\n';
      }
    } finally {
      // Release the parsed document; a long session would otherwise keep every resume in memory.
      void task.destroy();
    }
    const cleaned = text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (cleaned.length < 40) {
      warnings.push(
        'This PDF had almost no selectable text — it may be a scan or an image export. Paste your resume text manually for best results.',
      );
    }
    return { text: cleaned, kind: 'pdf', pages, warnings };
  }

  // --- DOCX ------------------------------------------------------------
  const looksZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (name.endsWith('.docx') || (looksZip && !name.endsWith('.zip'))) {
    try {
      const files = unzipSync(buf);
      const docPart =
        files['word/document.xml'] ?? files['word/document2.xml'] ?? undefined;
      if (!docPart) throw new Error('word/document.xml missing');
      const text = docxToText(strFromU8(docPart));
      return { text, kind: 'docx', warnings };
    } catch {
      // fall through to plain-text attempt
      warnings.push('Could not read that .docx as a zip archive — trying to read it as text.');
    }
  }

  // --- Plain text / markdown / rtf --------------------------------------
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (name.endsWith('.rtf') || text.startsWith('{\\rtf')) text = stripRtf(text);
  // Strip binary junk so a stray .doc does not produce thousands of control chars.
  const printable = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const ratio = printable.length / Math.max(text.length, 1);
  if (ratio < 0.8) {
    warnings.push(
      'That file looked binary (legacy .doc files are not supported) — the extracted text may be partial.',
    );
  }
  return { text: printable.trim(), kind: 'text', warnings };
}
