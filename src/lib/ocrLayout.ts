// Omvandlar OCR-resultat (ord med positioner) till ChordPro.

import { isChord } from './chords';
import { extractImportMeta } from './importMeta';
import { assembleChordPro, expandChordSuffixes, isChordLine, isChordToken, parseHeader, type Row, type SourceRow, type Token } from './layout';

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
    const all = src
      .filter((w) => w.text.trim())
      .map((w) => ({ text: w.text.trim(), x: w.x * sx, y: w.y * sy, w: w.w * sx, h: w.h * sy }));
    // Linjer och ramar läses som "ord" som är alldeles för breda för sina tecken
    const isRule = (w: OcrWord) => w.w > w.h * (1.5 * w.text.length + 1);
    const ruleWidth = all.filter(isRule).reduce((n, w) => n + w.w, 0);
    const span = all.length ? Math.max(...all.map((w) => w.x + w.w)) - Math.min(...all.map((w) => w.x)) : 0;
    // Mest linje: hela raden är brus
    if (ruleWidth > span * 0.5) continue;
    const words = all.filter((w) => !isRule(w));
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
  for (const l of lines) {
    l.words.sort((a, b) => a.x - b.x);
    // Ord som delats mitt i, t.ex. "J esus": nästan inget mellanrum och en liten bokstav efter
    l.words = l.words.reduce<OcrWord[]>((out, w) => {
      const prev = out[out.length - 1];
      if (prev && /\p{L}$/u.test(prev.text) && /^\p{Ll}/u.test(w.text) && w.x - (prev.x + prev.w) < Math.min(prev.h, w.h) * 0.15) {
        out[out.length - 1] = { ...prev, text: prev.text + w.text, w: w.x + w.w - prev.x, h: Math.max(prev.h, w.h) };
      } else out.push(w);
      return out;
    }, []);
  }
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
    tokens.push({ text: w.text, x: w.x, start, w: w.w, top: w.y, h: w.h });
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
 * Om ett ord från textigenkänningen ska användas. Ord med låg säkerhet är oftast brus (prickar,
 * streck), men i ovanliga typsnitt kan även riktiga ord och ackord få låg säkerhet, t.ex. "Åhh"
 * eller "F#m". Ord med minst två bokstäver behålls därför alltid.
 */
export function keepOcrWord(text: string, confidence: number): boolean {
  if (!text.trim()) return false;
  return confidence > 20 || /\p{L}.*\p{L}/u.test(text);
}

/** Ackord som lästs som andra tecken: kursivt 6 = G, 4 = A, ö = D; fetstilt C = 0 eller [0] */
const LOOKALIKE: Record<string, string> = { '6': 'G', '4': 'A', ö: 'D', Ö: 'D', '0': 'C', O: 'C', '[0]': 'C', '(0)': 'C' };

/**
 * Försöker rätta en felläst ackordbit. Vanliga fel: "Cc" för C, "G/F?" för G/F#, "C®" för C⁶,
 * "Di" för D¹¹ (upphöjda tecken), "GB" för G/B och två ackord som lästs som ett ("CG").
 * Returnerar null om biten inte går att tolka som ackord.
 */
export function fixOcrChord(t: Token, charW: number, raised = false): Token[] | null {
  if (isChordToken(t.text)) return [t];
  let s = t.text;
  // Upphöjd siffra som lästs som ett tecken högt upp: "Bm?" och "D'" för Bm⁷ och D⁷, "DI" för D¹¹
  if (raised) s = s.replace(/[?'’"”`]$/, '7').replace(/(?<=[A-H][#b]?(?:m|maj|sus|add)?)[Il|]{1,2}$/, '11');
  s = s
    // Efter m, sus m.m. kan ? inte vara ett korsförtecken: det är en upphöjd 7:a
    .replace(/(?<=[A-H][#b]?(?:m|maj|sus|add|dim))\?$/, '7')
    .replace(/[?”"“]/g, '#')
    .replace(/[®©]/g, '6')
    // Smuts före ackordet, t.ex. "oD", och efter, t.ex. "D'"
    .replace(/^[o°•·.,'’]+(?=[A-H])/, '')
    .replace(/(?<=\S)[°•·.,'’`]+$/, '');
  if (s in LOOKALIKE) s = LOOKALIKE[s];
  // Liten bokstav för ett ackord, t.ex. "c"
  if (/^[a-h]$/.test(s)) s = s.toUpperCase();
  // A med ring eller prickar ("ÅA", "ÅSuUS")
  s = s.replace(/^[ÅÄåä](?=[A-Za-z#]|$)/, 'A');
  // Versaler i hela ackordet, t.ex. "ASUS" för Asus
  const caps = /^([A-H][#b]?)([A-Za-z]{2,})(\d*)$/.exec(s);
  if (caps && !isChord(s)) {
    const lower = caps[2].toLowerCase();
    // Bokstäver som lästs två gånger, t.ex. "SuUS" för sus
    const single = lower.replace(/(.)\1/g, '$1');
    const fixed = [lower, single].map((x) => `${caps[1]}${x}${caps[3]}`).find((c) => isChord(c));
    if (fixed) s = fixed;
  }
  // Korsförtecknet läst som en bokstav: "Fam", "FAtm" och "FAm7" för F#m
  const sharp = /^([A-H])(?:a|A|At|At|H)(m.*|7.*|sus.*)$/.exec(s);
  if (sharp && !isChord(s) && isChord(`${sharp[1]}#${sharp[2]}`)) s = `${sharp[1]}#${sharp[2]}`;
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
  row = { ...row, tokens: expandChordSuffixes(row.tokens) };
  const texts = row.tokens.map((t) => t.text);
  if (isChordLine(texts)) return row;
  const widths = row.tokens.filter((t) => t.w).map((t) => t.w! / Math.max(1, t.text.length));
  const charW = median(widths) || row.spaceWidth;
  // Ackord med upphöjda tecken sticker upp över de andra och är högre
  const sized = row.tokens.filter((t) => t.top !== undefined && t.h);
  // Jämför med ackord som lästs rätt (utan upphöjt), annars med alla
  const plain = sized.filter((t) => /^[A-H][#b]?m?$/.test(t.text));
  const ref = plain.length ? plain : sized;
  const midTop = median(ref.map((t) => t.top!));
  const midH = median(ref.map((t) => t.h!));
  const raised = (t: Token) => sized.length >= 2 && t.top! < midTop - midH * 0.15 && t.h! > midH * 1.15;
  let fixed: Token[] = [];
  for (const t of row.tokens) {
    const f = fixOcrChord(t, charW, raised(t));
    if (f) fixed.push(...f);
    else fixed.push(t);
  }
  fixed = expandChordSuffixes(fixed);
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
    // Rubrik som går nästan ända fram till texten, t.ex. "Refräng" tätt intill första ordet
    const [first, second] = l.words;
    if (!labelWords.length && second && first.x < mainLeft - mh && second.x > mainLeft - mh * 0.5 && parseHeader(first.text)) {
      labelWords.push(first);
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

const FINGER = /^[xXoO0-9]$/;

/**
 * Tar bort ackordscheman för gitarr (t.ex. längst ner på noterna). De känns igen på raden med
 * grepp under schemat, t.ex. "X 3 2 0 1 0". Raden och ackordnamnet ovanför (och annat brus i
 * schemat) tas bort, annars blir de konstiga ackord och text.
 */
export function dropChordDiagrams(lines: VisualLine[]): VisualLine[] {
  const drop = new Set<OcrWord>();
  for (const l of lines) {
    // Följder av minst fyra enskilda strängtecken nära varandra, eller "x32010" (alla sex strängar) i ett ord
    const runs: OcrWord[][] = [];
    let run: OcrWord[] = [];
    const flush = () => {
      if (run.length >= 4) runs.push(run);
      run = [];
    };
    for (const w of l.words) {
      if (/^[xXoO0-9]{6}$/.test(w.text) && /\d/.test(w.text)) {
        flush();
        runs.push([w]);
        continue;
      }
      const prev = run[run.length - 1];
      if (FINGER.test(w.text) && (!prev || w.x - (prev.x + prev.w) <= Math.max(prev.w, w.h * 0.6) * 3)) run.push(w);
      else {
        flush();
        if (FINGER.test(w.text)) run.push(w);
      }
    }
    flush();
    for (const r of runs) {
      const count = r.reduce((n, w) => n + w.text.length, 0);
      if (count < 4) continue;
      const x0 = r[0].x;
      const x1 = r[r.length - 1].x + r[r.length - 1].w;
      // Flera scheman bredvid varandra kan ha lästs som en följd
      const dw = (x1 - x0) / Math.max(1, Math.round(count / 6));
      const top = Math.min(...r.map((w) => w.y));
      for (const w of r) drop.add(w);
      for (const o of lines) {
        for (const w of o.words) {
          const cx = w.x + w.w / 2;
          const cy = w.y + w.h / 2;
          if (cx < x0 - dw * 0.5 || cx > x1 + dw * 0.5 || cy >= top || cy < top - dw * 2.2) continue;
          if (isChord(w.text) || /^[A-H]{1,3}$/.test(w.text) || FINGER.test(w.text)) drop.add(w);
        }
      }
    }
  }
  if (!drop.size) return lines;
  return lines
    .map((l) => ({ ...l, words: l.words.filter((w) => !drop.has(w)) }))
    .filter((l) => l.words.length)
    .map((l) => ({ ...l, ...coreBounds(l.words) }));
}

/**
 * Sidfot nere till höger, t.ex. förlag, katalognummer och webbadress: rader längst ner på sidan
 * som börjar till höger om mitten. De är inte låttext; texten läggs i `footer`.
 */
export function splitFooter(lines: VisualLine[], page: OcrPage, footer: string[]): VisualLine[] {
  const w = page.width || 1;
  const h = page.height || 1;
  let i = lines.length;
  while (i > 0) {
    const l = lines[i - 1];
    if (l.top < h * 0.8 || Math.min(...l.words.map((x) => x.x)) < w * 0.5) break;
    i--;
  }
  // Allt på sidan kan inte vara sidfot
  if (i === 0) return lines;
  footer.push(...lines.slice(i).map((l) => l.words.map((x) => x.text).join(' ')));
  return lines.slice(0, i);
}

export function pageToRows(page: OcrPage, measure?: (t: string) => number, footer?: string[]): SourceRow[] {
  let lines = dropChordDiagrams(groupVisualLines(page));
  if (footer) lines = splitFooter(lines, page, footer);
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
  const footer: string[] = [];
  pages.forEach((p, i) => {
    if (i > 0) rows.push(null);
    rows.push(...pageToRows(p, measure, footer));
  });
  const body = extractImportMeta(joinSyllables(assembleChordPro(rows, { detectTitle: true, chordTolerance: CHORD_TOLERANCE })));
  // Sidfoten som kommentarer sist, en gång även om den står på varje sida
  const comments = [...new Set(footer)].map((t) => `{comment: ${t}}`);
  return comments.length ? `${body.trimEnd()}\n\n${comments.join('\n')}\n` : body;
}
