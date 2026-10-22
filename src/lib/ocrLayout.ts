// Omvandlar OCR-resultat (ord med positioner) till ChordPro.

import { isChord } from './chords';
import { assembleChordPro, isChordLine, isChordToken, parseHeader, type Row, type SourceRow, type Token } from './layout';

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

/** Tolerans för icke-ackord i ackordrader (OCR-brus) */
const CHORD_TOLERANCE = 0.25;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Övre och undre kant för en rad, utan små tecken som bindestreck och upphöjda siffror. */
function coreBounds(words: OcrWord[]): { top: number; bottom: number } {
  const maxH = Math.max(...words.map((w) => w.h));
  const core = words.filter((w) => w.h >= maxH * 0.6);
  return {
    top: Math.min(...core.map((w) => w.y)),
    bottom: Math.max(...core.map((w) => w.y + w.h)),
  };
}

/**
 * Bygger visuella rader. Textigenkänningens egna rader används som grund (de håller ihop små
 * tecken som bindestreck med sina ord). Rader som ligger på samma höjd, t.ex. utspridda ackord
 * som lästs som flera rader, slås ihop.
 */
export function groupVisualLines(page: OcrPage): VisualLine[] {
  const sx = page.width || 1;
  const sy = page.height || 1;
  const units: VisualLine[] = [];
  for (const line of page.lines) {
    const src = line.words.length ? line.words : [{ ...line, text: line.text }];
    const words = src
      .filter((w) => w.text.trim())
      .map((w) => ({ text: w.text.trim(), x: w.x * sx, y: w.y * sy, w: w.w * sx, h: w.h * sy }));
    if (!words.length) continue;
    units.push({ words, ...coreBounds(words) });
  }
  units.sort((a, b) => a.top + a.bottom - (b.top + b.bottom));

  const lines: VisualLine[] = [];
  for (const u of units) {
    let target: VisualLine | undefined;
    for (let k = lines.length - 1; k >= Math.max(0, lines.length - 3); k--) {
      const l = lines[k];
      const overlap = Math.min(l.bottom, u.bottom) - Math.max(l.top, u.top);
      const minH = Math.min(l.bottom - l.top, u.bottom - u.top);
      if (overlap < minH * 0.5) continue;
      const crosses = u.words.some((w) => l.words.some((o) => w.x < o.x + o.w - 2 && o.x < w.x + w.w - 2));
      if (!crosses) {
        target = l;
        break;
      }
    }
    if (target) {
      target.words.push(...u.words);
      target.top = Math.min(target.top, u.top);
      target.bottom = Math.max(target.bottom, u.bottom);
    } else {
      lines.push({ words: [...u.words], top: u.top, bottom: u.bottom });
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
    tokens.push({ text: w.text, x: w.x, start, w: w.w });
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

// --- Rättning av felästa ackord ---

/**
 * Försöker rätta en felläst ackordbit. Vanliga fel: "Cc" för C, "G/F?" för G/F#, "C®" för C⁶,
 * "Di" för D¹¹ (upphöjda tecken), "GB" för G/B och två ackord som lästs som ett ("CG").
 * Returnerar null om biten inte går att tolka som ackord.
 */
export function fixOcrChord(t: Token, charW: number): Token[] | null {
  if (isChordToken(t.text)) return [t];
  let s = t.text
    .replace(/[?”"“]/g, '#')
    .replace(/[®©]/g, '6')
    // Smuts före ackordet, t.ex. "oD"
    .replace(/^[o°•·.,'’]+(?=[A-G])/, '');
  const doubled = /^([A-G])\1$/i.exec(s);
  if (doubled) s = doubled[1].toUpperCase();
  // Upphöjt 11 läses ofta som i, l eller |
  s = s.replace(/^([A-G][#b]?(?:m|maj|sus|dim|add)?)[il|]{1,2}$/, '$111');
  if (isChord(s)) return [{ ...t, text: s }];

  // Två tonnamn: snedstrecksackord (GB = G/B) eller två ackord som slagits ihop (CG = C G)
  const split = /^([A-G][#b]?[^A-G/]*)([A-G][#b]?.*)$/.exec(s);
  if (split && isChord(split[1]) && isChord(split[2])) {
    const tight = !t.w || !charW || t.w <= s.length * charW * 1.5;
    const twoNotes = /^[A-G][#b]?$/.test(split[1]) && /^[A-G][#b]?$/.test(split[2]);
    if (tight && twoNotes && isChord(`${split[1]}/${split[2]}`)) return [{ ...t, text: `${split[1]}/${split[2]}` }];
    // Två ackord: det andra placeras i slutet av biten
    const w = t.w ?? s.length * charW;
    const secondX = t.x + w - split[2].length * charW;
    return [
      { ...t, text: split[1], w: split[1].length * charW },
      { ...t, text: split[2], x: Math.max(t.x + charW, secondX), w: split[2].length * charW },
    ];
  }
  return null;
}

/** Rättar en rad som ser ut att vara en ackordrad men har felästa ackord. */
function fixChordRow(row: Row): Row {
  const texts = row.tokens.map((t) => t.text);
  if (isChordLine(texts)) return row;
  const widths = row.tokens.filter((t) => t.w).map((t) => t.w! / Math.max(1, t.text.length));
  const charW = median(widths) || row.spaceWidth;
  const fixed: Token[] = [];
  for (const t of row.tokens) {
    const f = fixOcrChord(t, charW);
    if (f) fixed.push(...f);
    else fixed.push(t);
  }
  if (!isChordLine(fixed.map((t) => t.text), CHORD_TOLERANCE)) return row;
  return { ...row, tokens: fixed };
}

// --- Rubriker i vänstermarginalen ---

function headerRow(label: string, x: number): Row {
  return rowFromWords([{ text: `${label}:`, x, y: 0, w: label.length + 1, h: 1 }]);
}

/**
 * Hittar rubriker som står i en egen kolumn till vänster om texten, t.ex. "Vers 1" på samma
 * rad som första textraden. Rubriken flyttas till en egen rad före delen (före ackordraden
 * ovanför, om det finns en).
 */
function rowsWithMarginLabels(lines: VisualLine[], measure?: (t: string) => number): { rows: Row[]; gapsBefore: number[] } {
  const mh = median(lines.map((l) => l.bottom - l.top)) || 1;
  const mainLeft = median(lines.map((l) => l.words[0].x));
  const rows: Row[] = [];
  const gapsBefore: number[] = [];
  const lineIndexOfRow: number[] = [];

  lines.forEach((l, idx) => {
    const labelWords = [];
    for (const w of l.words) {
      if (w.x + w.w < mainLeft - mh * 0.8) labelWords.push(w);
      else break;
    }
    const label = labelWords.map((w) => w.text).join(' ');
    const header = label ? parseHeader(label) ?? parseHeader(`${label}:`) : null;
    const rest = header ? l.words.slice(labelWords.length) : l.words;

    if (header) {
      const hRow = headerRow(header.label, labelWords[0].x);
      // Hör ackordraden direkt ovanför till samma del? Lägg då rubriken före den.
      const prev = rows[rows.length - 1];
      const prevLine = lineIndexOfRow[lineIndexOfRow.length - 1];
      const prevIsChordAbove =
        prev &&
        prevLine === idx - 1 &&
        isChordLine(prev.tokens.map((t) => t.text), CHORD_TOLERANCE) &&
        l.top - lines[idx - 1].bottom < mh * 0.95;
      if (prevIsChordAbove) {
        rows.splice(rows.length - 1, 0, hRow);
        gapsBefore.splice(gapsBefore.length - 1, 0, gapsBefore[gapsBefore.length - 1]);
        gapsBefore[gapsBefore.length - 1] = 0;
        lineIndexOfRow.splice(lineIndexOfRow.length - 1, 0, idx - 1);
      } else {
        rows.push(hRow);
        gapsBefore.push(idx > 0 ? l.top - lines[idx - 1].bottom : 0);
        lineIndexOfRow.push(idx);
      }
      if (!rest.length) return;
      rows.push(fixChordRow(rowFromWords(rest, measure)));
      gapsBefore.push(0);
      lineIndexOfRow.push(idx);
      return;
    }
    rows.push(fixChordRow(rowFromWords(rest, measure)));
    gapsBefore.push(idx > 0 ? l.top - lines[idx - 1].bottom : 0);
    lineIndexOfRow.push(idx);
  });
  return { rows, gapsBefore };
}

export function pageToRows(page: OcrPage, measure?: (t: string) => number): SourceRow[] {
  const lines = groupVisualLines(page);
  if (!lines.length) return [];
  const mh = median(lines.map((l) => l.bottom - l.top)) || 1;
  const { rows, gapsBefore } = rowsWithMarginLabels(lines, measure);
  const out: SourceRow[] = [];
  rows.forEach((r, i) => {
    if (i > 0 && gapsBefore[i] > mh * 0.95) out.push(null);
    out.push(r);
  });
  return out;
}

/** Slår ihop stavelser som skrivits med bindestreck, t.ex. "Be - [G]reden" → "Be[G]reden". */
export function joinSyllables(chordPro: string): string {
  return chordPro
    .split('\n')
    .map((line) =>
      line.trim().startsWith('{') ? line : line.replace(/(\p{L}) +[-–] +((?:\[[^\]]*\])*)(?=\p{L})/gu, '$1$2'),
    )
    .join('\n');
}

export function ocrToChordPro(pages: OcrPage[], measure?: (t: string) => number): string {
  const rows: SourceRow[] = [];
  pages.forEach((p, i) => {
    if (i > 0) rows.push(null);
    rows.push(...pageToRows(p, measure));
  });
  return joinSyllables(assembleChordPro(rows, { detectTitle: true, chordTolerance: CHORD_TOLERANCE }));
}
