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

/**
 * En ChordPro-fil där en del ackord står på en egen rad ovanför texten, utan hakparenteser
 * (vanligt i filer som kopierats från webben). Bara de raderna görs om; direktiv, rader med
 * hakparenteser och tabulatur lämnas som de är.
 */
export function convertChordsAboveInChordPro(source: string, measure: Measure = monospaceMeasure): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let inTab = false;
  const plain = (l: string) => !!l.trim() && !l.includes('[') && !l.trim().startsWith('{');
  const isChordRow = (l: string) => plain(l) && !/:\s*$/.test(l) && isChordLine(l.trim().split(/\s+/));
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (/^\{(start_of_tab|sot|start_of_grid|sog)\b/i.test(t)) inTab = true;
    if (/^\{(end_of_tab|eot|end_of_grid|eog)\b/i.test(t)) inTab = false;
    if (inTab || !isChordRow(line)) {
      out.push(line);
      continue;
    }
    // Ackordraden och textraden under den (om det finns en) blir en rad
    const lyric = lines[i + 1];
    const pair = lyric !== undefined && plain(lyric) && !isChordRow(lyric) ? [line, lyric] : [line];
    const rows = textToRows(pair.join('\n'), measure);
    out.push(assembleChordPro(rows).trimEnd());
    i += pair.length - 1;
  }
  return out.join('\n');
}

export function titleFromFileName(name: string): string {
  return name
    // Filnamn från Mac och iPhone kan ha "å" som "a" + ring; gör om till ett tecken
    .normalize('NFC')
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
 * Typsnitten i listan som finns på enheten. Ett typsnitt som saknas mäts med ett
 * ersättningstypsnitt och går då inte att skilja från andra.
 */
export function availableSourceFonts(): SourceFont[] {
  const all = SOURCE_FONTS.map((f) => f.value);
  if (typeof document === 'undefined') return ['monospace'];
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return ['monospace'];
  const sample = 'mmmmmmmmmmlli WAV ÅÄÖ 0123456789';
  const width = (font: string) => {
    ctx.font = `100px ${font}`;
    return ctx.measureText(sample).width;
  };
  const mono = width('monospace');
  const serif = width('serif');
  // Finns typsnittet blir bredden en annan än ersättningstypsnittets med minst ett av dem
  return all.filter((f) => f === 'monospace' || width(`"${f}", monospace`) !== mono || width(`"${f}", serif`) !== serif);
}

/**
 * Hur väl ackorden passar över texten med en mätfunktion: andelen ackord som står precis över
 * början av ett ord, minus ackord som hamnar efter textradens slut (de räknas dubbelt).
 */
export function chordFit(text: string, measure: Measure): { chords: number; score: number } {
  const rows = textToRows(text, measure);
  let chords = 0;
  let onWord = 0;
  let over = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const r = rows[i];
    const n = rows[i + 1];
    if (!r || !n) continue;
    if (!isChordLine(r.tokens.map((t) => t.text))) continue;
    if (isChordLine(n.tokens.map((t) => t.text))) continue;
    const end = n.charX[n.text.length];
    // Ett halvt mellanslag åt vardera hållet räknas som samma ställe
    const near = n.spaceWidth / 2;
    for (const t of r.tokens) {
      if (!isChordToken(t.text)) continue;
      chords++;
      if (t.x > end + n.spaceWidth) over++;
      else if (n.tokens.some((w) => Math.abs(w.x - t.x) <= near)) onWord++;
    }
  }
  return { chords, score: chords ? (onWord - 2 * over) / chords : 0 };
}

/**
 * Gissar typsnittet som texten skrevs med: det där ackorden passar bäst över texten. Ett
 * proportionellt typsnitt väljs bara när det passar klart bättre än fast teckenbredd; lika bra
 * typsnitt (t.ex. Arial och Helvetica) avgörs av ordningen i listan.
 */
export function suggestSourceFont(
  text: string,
  measureFor: (f: SourceFont) => Measure,
  fonts: SourceFont[] = SOURCE_FONTS.map((f) => f.value),
): SourceFont {
  const mono = chordFit(text, monospaceMeasure);
  if (mono.chords === 0) return 'monospace';
  let best: SourceFont = 'monospace';
  let bestScore = mono.score;
  for (const font of fonts) {
    if (font === 'monospace') continue;
    const { score } = chordFit(text, measureFor(font));
    if (score > bestScore + 1e-9) {
      best = font;
      bestScore = score;
    }
  }
  return best !== 'monospace' && bestScore >= mono.score + 0.15 ? best : 'monospace';
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
  // Ta bort BOM och eventuella nolltecken som annars syns som mellanrum, och g\u00F6r om \u00E5, \u00E4 och \u00F6
  // skrivna som bokstav + prick/ring till ett tecken
  return text.replace(/^\uFEFF/, '').replace(/\u0000/g, '').normalize('NFC');
}
