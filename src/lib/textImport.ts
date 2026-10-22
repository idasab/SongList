// Import av textfiler: identifiera format och konvertera "ackord ovanför text" till ChordPro.

import { isChord } from './chords';
import { assembleChordPro, isChordLine, isChordToken, type Row, type SourceRow, type Token } from './layout';

/** Mäter textbredd. Monospace = antal tecken. */
export type Measure = (text: string) => number;

export const monospaceMeasure: Measure = (t) => t.length;

export type SourceFont = 'monospace' | 'Arial' | 'Helvetica' | 'Times New Roman' | 'Calibri' | 'Verdana' | 'Georgia';

export const SOURCE_FONTS: { value: SourceFont; label: string }[] = [
  { value: 'monospace', label: 'Fast teckenbredd (Courier, Consolas)' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'Calibri', label: 'Calibri' },
  { value: 'Verdana', label: 'Verdana' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Georgia', label: 'Georgia' },
];

/** Skapar en mätfunktion för ett typsnitt med hjälp av canvas (webbläsare). */
export function canvasMeasure(font: SourceFont): Measure {
  if (font === 'monospace' || typeof document === 'undefined') return monospaceMeasure;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return monospaceMeasure;
  const fallback = font === 'Times New Roman' || font === 'Georgia' ? 'serif' : 'sans-serif';
  ctx.font = `100px "${font}", ${fallback}`;
  const cache = new Map<string, number>();
  return (t) => {
    let w = cache.get(t);
    if (w === undefined) {
      w = ctx.measureText(t).width;
      cache.set(t, w);
    }
    return w;
  };
}

function expandTabs(line: string, size = 8): string {
  if (!line.includes('\t')) return line;
  let out = '';
  for (const ch of line) {
    if (ch === '\t') out += ' '.repeat(size - (out.length % size));
    else out += ch;
  }
  return out;
}

/** Bygger en rad med x-positioner för varje tecken utifrån en mätfunktion. */
export function textRow(line: string, measure: Measure): Row {
  const charX = new Array<number>(line.length + 1);
  // Mät prefix stegvis; för långa rader räcker det med kumulativ summa av tecken + par
  charX[0] = 0;
  for (let i = 1; i <= line.length; i++) charX[i] = measure(line.slice(0, i));
  const tokens: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) tokens.push({ text: m[0], start: m.index, x: charX[m.index] });
  return { text: line, charX, spaceWidth: measure(' ') || 1, tokens };
}

export function textToRows(text: string, measure: Measure): SourceRow[] {
  return text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => expandTabs(l.replace(/\s+$/, '')))
    .map((l) => (l.trim() === '' ? null : textRow(l, measure)));
}

export interface TextImportOptions {
  measure?: Measure;
  fileName?: string;
}

/** Konverterar text med ackord ovanför texten till ChordPro. */
export function textToChordPro(text: string, opts: TextImportOptions = {}): string {
  const rows = textToRows(text, opts.measure ?? monospaceMeasure);
  const fallbackTitle = opts.fileName ? titleFromFileName(opts.fileName) : undefined;
  const result = assembleChordPro(rows, { detectTitle: true });
  if (!/^\{title:/m.test(result) && fallbackTitle) {
    return `{title: ${fallbackTitle}}\n\n` + result;
  }
  return result;
}

export function titleFromFileName(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .trim();
}

/** Filändelser som alltid betyder ChordPro. */
const CHORDPRO_EXTENSIONS = /\.(cho|chopro|chordpro|crd|pro)$/i;

export function isChordProFileName(name: string): boolean {
  return CHORDPRO_EXTENSIONS.test(name.trim());
}

/** Avgör om en text redan är ChordPro (används när filändelsen inte avgör, t.ex. .txt). */
export function looksLikeChordPro(text: string): boolean {
  // Ett direktiv på egen rad, t.ex. {title: …}, {t: …}, {key: G}, {soc}
  if (/^\s*\{\s*[a-z_][\w-]*\s*(:[^}]*)?\}\s*$/im.test(text)) return true;
  for (const line of text.split(/\r?\n/)) {
    const re = /\[([^\]]+)\]/g;
    let m: RegExpExecArray | null;
    let chords = 0;
    while ((m = re.exec(line))) {
      if (isChord(m[1])) chords++;
    }
    // Ackord inbäddat i texten, eller flera ackord i hakparentes på samma rad
    if (chords > 0 && (line.replace(/\[[^\]]*\]/g, '').trim().length > 0 || chords >= 2)) return true;
  }
  return false;
}

/** Ser om texten innehåller ackordrader överhuvudtaget. */
export function hasChordLines(text: string): boolean {
  return text.split(/\r?\n/).some((l) => {
    const toks = l.trim().split(/\s+/).filter(Boolean);
    return toks.length > 0 && isChordLine(toks);
  });
}

/**
 * Försöker gissa om texten skrevs med proportionellt typsnitt. I proportionella typsnitt är
 * mellanslag smala, så ackorden står "för långt till höger" om man räknar tecken – ofta
 * efter textradens slut.
 */
export function suggestSourceFont(text: string, measureFor: (f: SourceFont) => Measure): SourceFont {
  const overflow = (measure: Measure) => {
    const rows = textToRows(text, measure);
    let total = 0;
    let over = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      const r = rows[i];
      const n = rows[i + 1];
      if (!r || !n) continue;
      if (!isChordLine(r.tokens.map((t) => t.text))) continue;
      if (isChordLine(n.tokens.map((t) => t.text))) continue;
      const end = n.charX[n.text.length];
      for (const t of r.tokens) {
        if (!isChordToken(t.text)) continue;
        total++;
        if (t.x > end + n.spaceWidth) over++;
      }
    }
    return { total, over };
  };
  const mono = overflow(monospaceMeasure);
  if (mono.total === 0) return 'monospace';
  const prop = overflow(measureFor('Arial'));
  if (mono.over >= 2 && mono.over > mono.total * 0.1 && prop.over < mono.over) return 'Arial';
  return 'monospace';
}

/** Gissar om text utan BOM är UTF-16 genom att räkna nollbyte på jämna och udda platser. */
function guessUtf16(b: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(b.length - (b.length % 2), 4000);
  if (n < 4) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < n; i += 2) {
    if (b[i] === 0) evenZeros++;
    if (b[i + 1] === 0) oddZeros++;
  }
  const pairs = n / 2;
  // Latinsk text i UTF-16 har en nollbyte i nästan varje teckenpar
  if (oddZeros > pairs * 0.3 && evenZeros < pairs * 0.05) return 'utf-16le';
  if (evenZeros > pairs * 0.3 && oddZeros < pairs * 0.05) return 'utf-16be';
  return null;
}

/**
 * Avkodar en textfil. Känner igen UTF-16 (vanligt från t.ex. Anteckningar och Word på Windows),
 * UTF-8 och Windows-1252 (vanligt i äldre svenska filer).
 */
export function decodeText(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let text: string;
  if (b[0] === 0xff && b[1] === 0xfe) text = new TextDecoder('utf-16le').decode(b.subarray(2));
  else if (b[0] === 0xfe && b[1] === 0xff) text = new TextDecoder('utf-16be').decode(b.subarray(2));
  else {
    const utf16 = guessUtf16(b);
    if (utf16) text = new TextDecoder(utf16).decode(b);
    else {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(b);
      } catch {
        text = new TextDecoder('windows-1252').decode(b);
      }
    }
  }
  // Ta bort BOM och eventuella nolltecken som annars syns som mellanrum
  return text.replace(/^\uFEFF/, '').replace(/\u0000/g, '');
}
