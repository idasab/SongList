// Omvandlar OCR-resultat (ord med positioner) till ChordPro.

import { assembleChordPro, type Row, type SourceRow, type Token } from './layout';

/** Normaliserade koordinater 0..1 med origo uppe till vänster. */
export interface OcrBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrWord extends OcrBox {
  text: string;
}

export interface OcrLine extends OcrBox {
  text: string;
  words: OcrWord[];
}

export interface OcrPage {
  /** Bildens storlek i pixlar (för korrekt bildförhållande) */
  width: number;
  height: number;
  lines: OcrLine[];
}

interface VisualLine {
  words: OcrWord[];
  top: number;
  bottom: number;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Slår ihop OCR-rader som ligger på samma höjd (t.ex. utspridda ackord) till visuella rader. */
export function groupVisualLines(page: OcrPage): VisualLine[] {
  const sx = page.width || 1;
  const sy = page.height || 1;
  const words: OcrWord[] = [];
  for (const line of page.lines) {
    const src = line.words.length ? line.words : [{ ...line, text: line.text }];
    for (const w of src) {
      if (!w.text.trim()) continue;
      words.push({ text: w.text.trim(), x: w.x * sx, y: w.y * sy, w: w.w * sx, h: w.h * sy });
    }
  }
  words.sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const lines: VisualLine[] = [];
  for (const w of words) {
    const cy = w.y + w.h / 2;
    let target: VisualLine | undefined;
    for (let k = lines.length - 1; k >= Math.max(0, lines.length - 3); k--) {
      const l = lines[k];
      const lh = l.bottom - l.top;
      const lcy = (l.top + l.bottom) / 2;
      if (Math.abs(cy - lcy) < Math.min(lh, w.h) * 0.55) {
        // Får inte överlappa horisontellt med befintliga ord
        const overlaps = l.words.some((o) => w.x < o.x + o.w - 2 && o.x < w.x + w.w - 2);
        if (!overlaps) {
          target = l;
          break;
        }
      }
    }
    if (target) {
      target.words.push(w);
      target.top = Math.min(target.top, w.y);
      target.bottom = Math.max(target.bottom, w.y + w.h);
    } else {
      lines.push({ words: [w], top: w.y, bottom: w.y + w.h });
    }
  }
  for (const l of lines) l.words.sort((a, b) => a.x - b.x);
  lines.sort((a, b) => a.top - b.top);
  return lines;
}

/**
 * Skapar en rad med teckenpositioner. Inom ett ord fördelas tecknen proportionellt
 * efter ungefärlig teckenbredd.
 */
export function rowFromWords(words: OcrWord[], measure: (t: string) => number = (t) => t.length): Row {
  let text = '';
  const charX: number[] = [];
  const tokens: Token[] = [];
  let totalChars = 0;
  let totalWidth = 0;
  words.forEach((w, idx) => {
    if (idx > 0) {
      // Mellanslaget sträcker sig från förra ordets slut till detta ords början
      text += ' ';
      charX.push(words[idx - 1].x + words[idx - 1].w);
    }
    const start = text.length;
    tokens.push({ text: w.text, x: w.x, start });
    const full = measure(w.text) || w.text.length;
    for (let i = 0; i < w.text.length; i++) {
      charX.push(w.x + (measure(w.text.slice(0, i)) / full) * w.w);
    }
    text += w.text;
    totalChars += w.text.length;
    totalWidth += w.w;
  });
  const last = words[words.length - 1];
  charX.push(last ? last.x + last.w : 0);
  const avgChar = totalChars ? totalWidth / totalChars : 1;
  return { text, charX, spaceWidth: avgChar * 0.9, tokens };
}

export function pageToRows(page: OcrPage, measure?: (t: string) => number): SourceRow[] {
  const lines = groupVisualLines(page);
  if (!lines.length) return [];
  const heights = lines.map((l) => l.bottom - l.top);
  const mh = median(heights) || 1;
  const rows: SourceRow[] = [];
  lines.forEach((l, idx) => {
    if (idx > 0) {
      const gap = l.top - lines[idx - 1].bottom;
      if (gap > mh * 0.95) rows.push(null);
    }
    rows.push(rowFromWords(l.words, measure));
  });
  return rows;
}

export function ocrToChordPro(pages: OcrPage[], measure?: (t: string) => number): string {
  const rows: SourceRow[] = [];
  pages.forEach((p, i) => {
    if (i > 0) rows.push(null);
    rows.push(...pageToRows(p, measure));
  });
  return assembleChordPro(rows, { detectTitle: true, chordTolerance: 0.25 });
}
