// Tolkning och redigering av ChordPro-text.

import {
  detectHNotation,
  formatChord,
  isMinorSuffix,
  keyPrefersFlats,
  parseChord,
  parseKey,
  type ChordContext,
} from './chords';
import { parseHeader, type Header } from './layout';

export interface Segment {
  chord?: string;
  text: string;
}

export type Line =
  | { type: 'lyrics'; segments: Segment[] }
  | { type: 'comment'; text: string; style: 'normal' | 'italic' | 'box' }
  | { type: 'empty' }
  | { type: 'pre'; text: string };

export type SectionType = 'none' | 'verse' | 'chorus' | 'bridge' | 'tab' | 'grid' | 'other';

export interface Section {
  type: SectionType;
  label?: string;
  lines: Line[];
  /** Sant om sektionen är en upprepning av en tidigare refräng ({chorus}) */
  isRepeat?: boolean;
  /** Startad av en rubrikrad som "Vers 1:" i stället för ett direktiv; slutar vid tomrad */
  implicit?: boolean;
}

const HEADER_SECTION: Record<Exclude<Header['kind'], 'comment'>, SectionType> = {
  verse: 'verse',
  chorus: 'chorus',
  bridge: 'bridge',
};

/**
 * Rubrikrader som kortform för direktiv: "Vers 1:" = {start_of_verse: Vers 1},
 * "Refräng:" = {start_of_chorus}, "Intro: G C" = {comment: Intro} + ackordrad.
 * Vers/refräng/stick godtas med eller utan kolon; övriga rubriker (Intro, Solo …) kräver kolon
 * så att en vanlig textrad inte misstolkas.
 */
export function chordProHeader(line: string): Header | null {
  const h = parseHeader(line);
  if (!h) return null;
  if (h.kind !== 'comment') return h;
  return /^\s*[\[(]?\s*[A-Za-zÅÄÖåäö-]+\.?\s*\d*\s*[\])]?\s*:/.test(line) ? h : null;
}

/** Ackorden efter en rubrik ("G C D" eller "[G] [C]") som en ChordPro-rad. */
function trailingChordLine(trailing: string): string {
  return trailing
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (t.startsWith('[') ? t : `[${t}]`))
    .join(' ');
}

export interface SongMeta {
  title?: string;
  subtitle?: string;
  artist?: string;
  composer?: string;
  lyricist?: string;
  album?: string;
  year?: string;
  key?: string;
  capo?: string;
  tempo?: string;
  time?: string;
  duration?: string;
  copyright?: string;
}

export interface ParsedSong {
  meta: SongMeta;
  sections: Section[];
  /** Alla ackord i den ordning de förekommer (unika) */
  chords: string[];
  /** Sant om sången skrivits med svensk notation (H) */
  hNotation: boolean;
}

const DIRECTIVE_ALIASES: Record<string, string> = {
  t: 'title',
  st: 'subtitle',
  su: 'subtitle',
  c: 'comment',
  ci: 'comment_italic',
  cb: 'comment_box',
  soc: 'start_of_chorus',
  eoc: 'end_of_chorus',
  sov: 'start_of_verse',
  eov: 'end_of_verse',
  sob: 'start_of_bridge',
  eob: 'end_of_bridge',
  sot: 'start_of_tab',
  eot: 'end_of_tab',
  sog: 'start_of_grid',
  eog: 'end_of_grid',
  highlight: 'comment',
};

const META_KEYS: Record<string, keyof SongMeta> = {
  title: 'title',
  subtitle: 'subtitle',
  artist: 'artist',
  composer: 'composer',
  lyricist: 'lyricist',
  album: 'album',
  year: 'year',
  key: 'key',
  capo: 'capo',
  tempo: 'tempo',
  time: 'time',
  duration: 'duration',
  copyright: 'copyright',
};

const DIRECTIVE_RE = /^\s*\{\s*([A-Za-z_][\w-]*)\s*(?::\s*|\s+)?(.*?)\s*\}\s*$/;

export interface Directive {
  name: string;
  value: string;
}

export function parseDirective(line: string): Directive | null {
  const m = DIRECTIVE_RE.exec(line);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  const name = DIRECTIVE_ALIASES[raw] ?? raw;
  return { name, value: m[2] ?? '' };
}

/** Plockar ut etikett från "Vers 1" eller ChordPro 6-syntax label="Vers 1". */
function sectionLabel(value: string): string | undefined {
  const attr = /label\s*=\s*"([^"]*)"/.exec(value);
  if (attr) return attr[1] || undefined;
  return value.trim() || undefined;
}

export function parseLyricsLine(line: string): Segment[] {
  const segments: Segment[] = [];
  const re = /\[([^\]]*)\]/g;
  let last = 0;
  let chord: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const text = line.slice(last, m.index);
    if (text || chord !== undefined) segments.push({ chord, text });
    chord = m[1];
    last = m.index + m[0].length;
  }
  const tail = line.slice(last);
  if (tail || chord !== undefined) segments.push({ chord, text: tail });
  return segments;
}

const START_TYPES: Record<string, SectionType> = {
  start_of_chorus: 'chorus',
  start_of_verse: 'verse',
  start_of_bridge: 'bridge',
  start_of_tab: 'tab',
  start_of_grid: 'grid',
};

const DEFAULT_LABELS: Partial<Record<SectionType, string>> = {
  chorus: 'Refräng',
  bridge: 'Stick',
};

export function parseChordPro(source: string): ParsedSong {
  const meta: SongMeta = {};
  const sections: Section[] = [];
  const chords: string[] = [];
  const seen = new Set<string>();
  let current: Section = { type: 'none', lines: [] };
  let lastChorus: Section | null = null;

  const closeSection = () => {
    if (current.lines.length > 0 || current.type !== 'none') {
      // Ta bort avslutande tomrader i sektionen
      while (current.lines.length && current.lines[current.lines.length - 1].type === 'empty') {
        current.lines.pop();
      }
      if (current.lines.length > 0 || current.label) sections.push(current);
      if (current.type === 'chorus' && !current.isRepeat) lastChorus = current;
    }
    current = { type: 'none', lines: [] };
  };

  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].replace(/\s+$/, '');
    const inPre = current.type === 'tab' || current.type === 'grid';

    if (/^\s*#/.test(line) && !inPre) continue; // kommentar i källfilen

    const dir = line.trim().startsWith('{') ? parseDirective(line) : null;
    if (dir) {
      const metaKey = META_KEYS[dir.name];
      if (metaKey) {
        if (!meta[metaKey]) meta[metaKey] = dir.value;
        continue;
      }
      if (dir.name === 'meta') {
        const mm = /^(\S+)\s+(.*)$/.exec(dir.value);
        const k = mm && META_KEYS[mm[1].toLowerCase()];
        if (mm && k && !meta[k]) meta[k] = mm[2];
        continue;
      }
      if (dir.name in START_TYPES) {
        closeSection();
        const type = START_TYPES[dir.name];
        current = { type, label: sectionLabel(dir.value) ?? DEFAULT_LABELS[type], lines: [] };
        continue;
      }
      if (dir.name.startsWith('start_of_')) {
        closeSection();
        current = { type: 'other', label: sectionLabel(dir.value), lines: [] };
        continue;
      }
      if (dir.name.startsWith('end_of_')) {
        closeSection();
        continue;
      }
      if (dir.name === 'chorus') {
        closeSection();
        const ref = lastChorus as Section | null;
        sections.push({
          type: 'chorus',
          label: sectionLabel(dir.value) ?? ref?.label ?? 'Refräng',
          lines: ref ? ref.lines : [],
          isRepeat: true,
        });
        continue;
      }
      if (dir.name === 'comment' || dir.name === 'comment_italic' || dir.name === 'comment_box') {
        const style = dir.name === 'comment' ? 'normal' : dir.name === 'comment_italic' ? 'italic' : 'box';
        current.lines.push({ type: 'comment', text: dir.value, style });
        continue;
      }
      // Okända direktiv (x_*, new_page, textfont m.fl.) ignoreras i visningen.
      continue;
    }

    if (inPre) {
      current.lines.push({ type: 'pre', text: line });
      continue;
    }

    if (line.trim() === '') {
      if (current.implicit) {
        // Sektion som startats med en rubrikrad slutar vid tomrad
        closeSection();
      } else if (current.type === 'none') {
        // Tomrad utanför en sektion: avsluta stycket
        if (current.lines.length) closeSection();
      } else {
        current.lines.push({ type: 'empty' });
      }
      continue;
    }

    const header = chordProHeader(line);
    if (header) {
      if (header.kind === 'comment') {
        current.lines.push({ type: 'comment', text: header.label, style: 'normal' });
      } else {
        const next = lines[li + 1]?.trim();
        if (header.kind === 'chorus' && !header.trailing && (next === undefined || next === '' || next.startsWith('{'))) {
          // "Refräng" ensamt på en rad = upprepa refrängen, som {chorus}
          closeSection();
          const ref = lastChorus as Section | null;
          sections.push({ type: 'chorus', label: header.label, lines: ref ? ref.lines : [], isRepeat: true });
          continue;
        }
        closeSection();
        current = { type: HEADER_SECTION[header.kind], label: header.label, lines: [], implicit: true };
      }
      if (!header.trailing) continue;
    }

    const segments = parseLyricsLine(header?.trailing ? trailingChordLine(header.trailing) : line);
    for (const s of segments) {
      if (s.chord && !s.chord.startsWith('*') && !seen.has(s.chord)) {
        seen.add(s.chord);
        chords.push(s.chord);
      }
    }
    current.lines.push({ type: 'lyrics', segments });
  }
  closeSection();

  return { meta, sections, chords, hNotation: detectHNotation(chords) };
}

// Tecken som får stå mellan ackorden i en ackordrad: taktstreck, snedstreck för slag,
// repetitioner (x2) m.m. – men inga ord.
const CHORD_ROW_TEXT = /^[\s/|\\:.,;\-–—%*()\[\]0-9x×]*$/i;

/**
 * Sant om raden bara innehåller ackord och taktsymboler, t.ex. "[C] / / [G/B] / / | [Am]".
 * En sådan rad visas på en enda rad i stället för ackord ovanför "text".
 */
export function isChordRow(segments: Segment[]): boolean {
  return segments.some((s) => s.chord !== undefined) && segments.every((s) => CHORD_ROW_TEXT.test(s.text));
}

/** Text utan ackord och direktiv – för fritextsökning. */
export function lyricsText(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((l) => !/^\s*[{#]/.test(l))
    .map((l) => l.replace(/\[[^\]]*\]/g, ''))
    .join('\n');
}

// --- Redigering av direktiv ---

const DIRECTIVE_NAME_VARIANTS: Record<string, string[]> = {
  title: ['title', 't'],
  subtitle: ['subtitle', 'st', 'su'],
};

/**
 * Sätter (eller tar bort, om value är tomt) ett metadirektiv i källtexten.
 * Nya direktiv läggs till efter de inledande direktiven i filen.
 */
export function upsertDirective(source: string, name: string, value: string): string {
  const variants = DIRECTIVE_NAME_VARIANTS[name] ?? [name];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const idx = lines.findIndex((l) => {
    const d = parseDirective(l);
    if (!d) return false;
    const raw = /^\s*\{\s*([A-Za-z_][\w-]*)/.exec(l)?.[1].toLowerCase() ?? '';
    return variants.includes(raw);
  });
  const trimmed = value.trim();
  if (idx >= 0) {
    if (trimmed) lines[idx] = `{${name}: ${trimmed}}`;
    else lines.splice(idx, 1);
    return lines.join('\n');
  }
  if (!trimmed) return source;
  // Hitta slutet av de inledande metadirektiven
  let insertAt = 0;
  while (insertAt < lines.length) {
    const d = parseDirective(lines[insertAt]);
    if (d && (META_KEYS[d.name] || d.name === 'meta')) insertAt++;
    else break;
  }
  lines.splice(insertAt, 0, `{${name}: ${trimmed}}`);
  return lines.join('\n');
}

/** Skriver om alla ackord i källtexten transponerade (permanent transponering). */
export function transposeSource(source: string, ctx: ChordContext): string {
  const hNotation = detectHNotation(parseChordPro(source).chords);
  const c = { ...ctx, hNotation };
  return source
    .split(/\r?\n/)
    .map((line) => {
      const dir = line.trim().startsWith('{') ? parseDirective(line) : null;
      if (dir) {
        if (dir.name === 'key' && dir.value) {
          return `{key: ${formatChord(dir.value, c)}}`;
        }
        return line;
      }
      // "Intro: G C D" – ackord utan hakparenteser efter en rubrik
      const header = chordProHeader(line);
      if (header?.trailing && !header.trailing.includes('[')) {
        const at = line.lastIndexOf(header.trailing);
        const chordsPart = header.trailing.replace(/\S+/g, (t) => formatChord(t, c));
        return line.slice(0, at) + chordsPart;
      }
      return line.replace(/\[([^\]]*)\]/g, (_, chord: string) => `[${formatChord(chord, c)}]`);
    })
    .join('\n');
}

/** Hämtar alla ackord ur en källtext. */
export function chordsInSource(source: string): string[] {
  return parseChordPro(source).chords.filter((c) => parseChord(c) !== null);
}

/** Avgör om transponerade ackord ska skrivas med b-förtecken, utifrån tonart eller första ackordet. */
export function songPrefersFlats(song: ParsedSong, transpose: number): boolean {
  let key = parseKey(song.meta.key, { hNotation: song.hNotation });
  if (!key && song.chords.length) {
    const c = parseChord(song.chords[0], { hNotation: song.hNotation });
    if (c) key = { pc: c.root, minor: isMinorSuffix(c.suffix) };
  }
  if (!key) return false;
  return keyPrefersFlats((((key.pc + transpose) % 12) + 12) % 12, key.minor);
}
