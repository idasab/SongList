// Gemensam logik för att omvandla rader med positionerad text (från textfiler eller OCR)
// till ChordPro. Ackordens placering avgörs av deras visuella x-position – inte av antal tecken.

import { isChord } from './chords';

export interface Token {
  text: string;
  /** Vänsterkant i samma enhet som charX */
  x: number;
  /** Teckenindex i radens text */
  start: number;
}

export interface Row {
  text: string;
  /** charX[i] = x-position för gränsen före tecken i (längd text.length + 1) */
  charX: number[];
  /** Ungefärlig bredd på ett mellanslag, används för att fylla ut efter radslut */
  spaceWidth: number;
  tokens: Token[];
}

/** En rad i källan; null betyder tomrad. */
export type SourceRow = Row | null;

// --- Klassificering ---

const NOISE_TOKEN = /^(\||\|\||\/|-+|–|—|\.+|:|%|x\d+|\(?x\d+\)?|\d+x|\(\d+x\)|n\.?c\.?|\*|\(|\))$/i;

function stripParens(t: string): string {
  return t.replace(/^[(\[]+/, '').replace(/[)\],.]+$/, '');
}

export function isChordToken(t: string): boolean {
  return isChord(stripParens(t));
}

/** En rad räknas som ackordrad om (nästan) alla ord är ackord. */
export function isChordLine(tokens: string[], tolerance = 0): boolean {
  const meaningful = tokens.filter((t) => !NOISE_TOKEN.test(t));
  if (meaningful.length === 0) return false;
  const chordCount = meaningful.filter(isChordToken).length;
  if (chordCount === 0) return false;
  const nonChords = meaningful.length - chordCount;
  return nonChords <= Math.floor(meaningful.length * tolerance);
}

export type HeaderKind = 'verse' | 'chorus' | 'bridge' | 'comment';

export interface Header {
  kind: HeaderKind;
  label: string;
  /** Ackord som stod efter rubriken på samma rad, t.ex. "Intro: G C D" */
  trailing?: string;
}

const HEADER_WORDS: [RegExp, HeaderKind][] = [
  [/^(refräng|refr|ref|chorus|omkväde|kör|refrain)$/i, 'chorus'],
  [/^(vers|verse|strof)$/i, 'verse'],
  [/^(bridge|stick|brygga)$/i, 'bridge'],
  [
    /^(intro|outro|förspel|efterspel|mellanspel|slut|ending|coda|pre-?chorus|förrefräng|instrumental|solo|interlude|tag|vamp|riff)$/i,
    'comment',
  ],
];

const HEADER_RE = /^\s*[\[(]?\s*([A-Za-zÅÄÖåäö-]+)\.?\s*(\d+)?\s*[\])]?\s*:?\s*(.*)$/;

export function parseHeader(line: string): Header | null {
  const trimmed = line.trim();
  const m = HEADER_RE.exec(trimmed);
  if (m) {
    const word = m[1];
    const kind = HEADER_WORDS.find(([re]) => re.test(word))?.[1];
    if (kind) {
      const rest = m[3].trim();
      const label = (word.charAt(0).toUpperCase() + word.slice(1) + (m[2] ? ' ' + m[2] : '')).trim();
      if (!rest) return { kind, label };
      if (isChordLine(rest.split(/\s+/))) return { kind, label, trailing: rest };
      return null;
    }
  }
  // "[Något]" på egen rad som inte är ett ackord, t.ex. [Verse 1] från webbsidor
  const br = /^\[([^\]]+)\]$/.exec(trimmed);
  if (br && !isChordToken(br[1])) return { kind: 'comment', label: br[1].trim() };
  return null;
}

// --- Sammanfogning av ackordrad + textrad ---

/** Placerar ackorden från en ackordrad i en textrad baserat på x-position. */
export function mergeChordsIntoRow(chords: Token[], lyric: Row): string {
  const text = lyric.text.replace(/\s+$/, '');
  const charX = lyric.charX.slice(0, text.length + 1);
  let padded = text;
  const sorted = [...chords].sort((a, b) => a.x - b.x);
  const maxX = sorted.length ? sorted[sorted.length - 1].x : 0;
  const sw = lyric.spaceWidth > 0 ? lyric.spaceWidth : 1;
  // Fyll ut med mellanslag om ackord står efter radens slut
  while (charX[charX.length - 1] + sw * 0.5 < maxX) {
    padded += ' ';
    charX.push(charX[charX.length - 1] + sw);
  }

  const positions = sorted.map((c) => {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < charX.length; i++) {
      const d = Math.abs(charX[i] - c.x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    // Hamnar ackordet på ett mellanslag: flytta fram till nästa ords början
    let i = best;
    while (i < text.length && padded[i] === ' ') i++;
    if (i < text.length && i > best) best = i;
    return best;
  });

  // Undvik att två ackord hamnar på samma ställe i onödan: behåll ordningen
  for (let k = 1; k < positions.length; k++) {
    if (positions[k] < positions[k - 1]) positions[k] = positions[k - 1];
  }

  let out = padded;
  for (let k = sorted.length - 1; k >= 0; k--) {
    const p = positions[k];
    out = out.slice(0, p) + `[${sorted[k].text}]` + out.slice(p);
  }
  return out.replace(/\s+$/, '');
}

/** En ackordrad utan text under: behåll ungefärliga avstånd mellan ackorden. */
export function chordOnlyLine(chords: Token[], spaceWidth: number): string {
  const sorted = [...chords].sort((a, b) => a.x - b.x);
  const sw = spaceWidth > 0 ? spaceWidth : 1;
  let out = '';
  for (let k = 0; k < sorted.length; k++) {
    const c = sorted[k];
    out += isChordToken(c.text) ? `[${c.text}]` : c.text;
    if (k < sorted.length - 1) {
      const gap = (sorted[k + 1].x - c.x) / sw - c.text.length;
      out += ' '.repeat(Math.min(8, Math.max(1, Math.round(gap))));
    }
  }
  return out;
}

// --- Montering till ChordPro ---

export interface AssembleOptions {
  title?: string;
  artist?: string;
  /** Tolerans för icke-ackord i ackordrader (OCR-brus) */
  chordTolerance?: number;
  /** Försök hitta titel/artist i de första raderna */
  detectTitle?: boolean;
}

const ENV_NAMES: Record<Exclude<HeaderKind, 'comment'>, string> = {
  verse: 'verse',
  chorus: 'chorus',
  bridge: 'bridge',
};

export function assembleChordPro(rows: SourceRow[], opts: AssembleOptions = {}): string {
  const tol = opts.chordTolerance ?? 0;
  const out: string[] = [];
  let title = opts.title;
  let artist = opts.artist;

  // Ta bort inledande/avslutande tomrader
  let start = 0;
  while (start < rows.length && rows[start] === null) start++;
  let end = rows.length;
  while (end > start && rows[end - 1] === null) end--;
  rows = rows.slice(start, end);

  const chordFlags = rows.map((r) => (r ? isChordLine(r.tokens.map((t) => t.text), tol) : false));

  // Titel och artist: ett kort inledande stycke (högst två rader) utan ackord, följt av tomrad.
  let i = 0;
  if (opts.detectTitle) {
    const firstBlank = rows.indexOf(null);
    if (firstBlank > 0 && firstBlank <= 2 && rows.length > firstBlank + 1) {
      const head = rows.slice(0, firstBlank) as Row[];
      const anyChord = chordFlags.slice(0, firstBlank).some(Boolean);
      const anyHeader = head.some((r) => parseHeader(r.text));
      if (!anyChord && !anyHeader && head.every((r) => r.text.trim().length <= 60)) {
        title = head[0].text.trim();
        if (head[1]) {
          artist = head[1].text.trim().replace(/^(av|by|text och musik:?|musik:?|artist:?)\s+/i, '');
        }
        i = firstBlank + 1;
      }
    }
  }

  if (title) out.push(`{title: ${title}}`);
  if (artist) out.push(`{artist: ${artist}}`);
  if (out.length) out.push('');

  let openEnv: string | null = null;
  const closeEnv = () => {
    if (openEnv) {
      out.push(`{end_of_${openEnv}}`);
      openEnv = null;
    }
  };

  for (; i < rows.length; i++) {
    const row = rows[i];
    if (row === null) {
      closeEnv();
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    const text = row.text.trim();

    if (/^\{.*\}$/.test(text)) {
      out.push(text);
      continue;
    }

    const header = chordFlags[i] ? null : parseHeader(text);
    if (header) {
      closeEnv();
      const next = rows[i + 1];
      if (header.kind === 'comment') {
        out.push(`{comment: ${header.label}}`);
      } else if (header.kind === 'chorus' && !header.trailing && (next === null || next === undefined)) {
        // "Refräng" ensamt följt av tomrad = upprepa refrängen
        out.push(header.label.toLowerCase().startsWith('ref') ? '{chorus}' : `{chorus: ${header.label}}`);
      } else {
        const env = ENV_NAMES[header.kind];
        out.push(`{start_of_${env}: ${header.label}}`);
        openEnv = env;
      }
      if (header.trailing) {
        const toks = header.trailing.split(/\s+/).map((t, k) => ({ text: t, x: k * 4, start: 0 }));
        out.push(chordOnlyLine(toks, 1));
      }
      continue;
    }

    if (chordFlags[i]) {
      const chords = row.tokens.filter((t) => !NOISE_TOKEN.test(t.text));
      const next = rows[i + 1];
      const nextIsLyric =
        next !== null && next !== undefined && !chordFlags[i + 1] && !parseHeader(next.text) && !/^\{.*\}$/.test(next.text.trim());
      if (nextIsLyric) {
        out.push(mergeChordsIntoRow(chords, next));
        i++;
      } else {
        out.push(chordOnlyLine(row.tokens, row.spaceWidth));
      }
      continue;
    }

    out.push(row.text.replace(/\s+$/, ''));
  }
  closeEnv();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}
