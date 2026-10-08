// ---------------------------------------------------------------------------
// DOCX body text, read straight out of word/document.xml.
//
// Kept free of browser/pdf.js imports so the Node self-test can exercise it.
// ---------------------------------------------------------------------------

/** Decode the XML entities Word actually writes, including numeric references. */
export function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => codePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function codePoint(n: number): string {
  return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

/**
 * Pull the text runs out of a docx body. Each token is matched exactly, so
 * `<w:tbl>`, `<w:tr>`, `<w:tblPr>` are never mistaken for a text run `<w:t>`
 * (the old pattern swallowed table markup into the resume as raw XML).
 */
export function docxToText(xml: string): string {
  const TOKEN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<\/w:p>|<\/w:tc>|<\/w:tr>/g;
  let text = '';
  for (const m of xml.matchAll(TOKEN)) {
    if (m[1] !== undefined) text += decodeXml(m[1]);
    else if (m[0].startsWith('<w:tab')) text += '\t';
    else if (m[0] === '</w:tc>') text += '\t';
    else text += '\n';
  }
  return text
    .split('\n')
    .map((line) => line.replace(/\t+$/g, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
