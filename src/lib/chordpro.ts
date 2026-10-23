// Tolkning och redigering av ChordPro-text.

import {
  detectHNotation,
  formatChord,
  formatKey,
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
  part: 'other',
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

    // En hel rad inom parentes, t.ex. "(Upprepa refrängen)", är en kommentar
    const paren = /^\s*\((.*)\)\s*$/.exec(line);
    if (paren && !line.includes('[')) {
      current.lines.push({ type: 'comment', text: paren[1].trim(), style: 'normal' });
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

/**
 * Delar upp segment ord för ord så att raderna kan radbrytas mellan orden.
 *
 * Ett ackord som står på mellanslaget före ett ord, t.ex. "fem,[A/C#] sex", flyttas till
 * ordet. Annars breddas mellanslaget till ackordets bredd och ger ett stort hål mitt i raden.
 * Mellanslaget läggs på föregående ord så att ordavståndet blir som vanligt.
 */
export function splitWords(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const parts = s.text.match(/\S*\s*/g)?.filter(Boolean) ?? [];
    if (parts.length <= 1) {
      out.push({ ...s });
      continue;
    }
    let chord = s.chord;
    parts.forEach((p, i) => {
      if (i === 0 && chord !== undefined && !p.trim()) {
        const prev = out[out.length - 1];
        if (prev) prev.text += p;
        else out.push({ text: p });
        return; // ackordet följer med till nästa ord
      }
      out.push({ chord, text: p });
      chord = undefined;
    });
  }
  return out;
}

/**
 * Sant för varje bit där ett ord fortsätter i nästa bit (ett ackord står mitt i ordet).
 * Där kan ett bindestreck visas om ackordet gör att det blir ett mellanrum i ordet.
 */
export function midWordBreaks(segments: Segment[]): boolean[] {
  return segments.map((s, i) => {
    const next = segments[i + 1];
    return !!next && /\p{L}$/u.test(s.text) && /^\p{L}/u.test(next.text);
  });
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
  // Både {title: X} (och kortformer som {t: X}) och {meta: title X} räknas
  const matches = (l: string) => {
    const d = parseDirective(l);
    if (!d) return false;
    const raw = /^\s*\{\s*([A-Za-z_][\w-]*)/.exec(l)?.[1].toLowerCase() ?? '';
    if (variants.includes(raw)) return true;
    if (d.name !== 'meta') return false;
    const sub = /^(\S+)/.exec(d.value.trim())?.[1].toLowerCase() ?? '';
    return variants.includes(sub) || (!!META_KEYS[sub] && META_KEYS[sub] === META_KEYS[name]);
  };
  // Bara direktiven överst i låten, före texten: ett {key: D} längre ner är ett tonartsbyte
  // och ska stå kvar
  let headerEnd = 0;
  while (headerEnd < lines.length) {
    const l = lines[headerEnd].trim();
    const d = parseDirective(l);
    if (!l || l.startsWith('#') || (d && (META_KEYS[d.name] || d.name === 'meta'))) headerEnd++;
    else break;
  }
  const found = lines.slice(0, headerEnd).flatMap((l, i) => (matches(l) ? [i] : []));
  const trimmed = value.trim();
  if (found.length) {
    // Det första direktivet gäller när låten läses. Ta bort andra {name: …} så att det nya
    // värdet syns, men lämna {meta: …}, som kan ha flera värden (t.ex. flera artister)
    const isMeta = (i: number) => parseDirective(lines[i])?.name === 'meta';
    const extra = trimmed ? found.slice(1).filter((i) => !isMeta(i)) : found.slice(1);
    for (const i of extra.reverse()) lines.splice(i, 1);
    if (trimmed) lines[found[0]] = `{${name}: ${trimmed}}`;
    else lines.splice(found[0], 1);
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
        // Tonarten flyttas med, även skriven som "A moll" eller {meta: key A}
        const metaKey = dir.name === 'meta' ? /^key\s+(.+)$/i.exec(dir.value.trim())?.[1] : undefined;
        const keyValue = dir.name === 'key' ? dir.value.trim() : metaKey;
        if (keyValue) {
          const k = parseKey(keyValue, { hNotation });
          const moved = k ? formatKey(k, c.transpose, c.notation) : formatChord(keyValue, c);
          return dir.name === 'meta' ? `{meta: key ${moved}}` : `{key: ${moved}}`;
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
/** Kapo enligt {capo}, 0 om det saknas. */
export function capoOf(song: ParsedSong): number {
  const n = parseInt(song.meta.capo ?? '', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(11, n) : 0;
}

/**
 * Hur ackorden visas. Ackorden i låten är de som klingar; med kapo visas greppen, dvs.
 * ackorden flyttade ner så många halvtoner som kapot sitter (A med kapo 2 visas som G).
 */
export function displayChordContext(song: ParsedSong, transpose: number, notation: ChordContext['notation']): ChordContext {
  const shift = transpose - capoOf(song);
  return { transpose: shift, preferFlats: songPrefersFlats(song, shift), notation, hNotation: song.hNotation };
}

type Quality = 'maj' | 'min' | 'dim' | 'any';

// Ackorden som hör till en tonart: steg i halvtoner från grundtonen och om de är dur eller moll
const MAJOR_CHORDS: Record<number, Quality[]> = { 0: ['maj'], 2: ['min'], 4: ['min'], 5: ['maj'], 7: ['maj'], 9: ['min'], 11: ['dim'] };
// Moll: naturlig moll, plus dur på femte steget (dominanten) och förminskat på sjunde
const MINOR_CHORDS: Record<number, Quality[]> = {
  0: ['min'],
  2: ['dim'],
  3: ['maj'],
  5: ['min'],
  7: ['min', 'maj'],
  8: ['maj'],
  10: ['maj'],
  11: ['dim'],
};

function quality(suffix: string): Quality {
  if (/^(dim|°|o(?!.)|m7b5|ø)/.test(suffix)) return 'dim';
  if (isMinorSuffix(suffix)) return 'min';
  // sus- och kvintackord kan vara både dur och moll
  if (/^(sus|5$)/.test(suffix)) return 'any';
  return 'maj';
}

/** Hur många av ackorden som hör till tonarten, med hänsyn till om de är dur eller moll. */
function fitsKey(chords: { root: number; q: Quality }[], tonic: number, minor: boolean): number {
  const table = minor ? MINOR_CHORDS : MAJOR_CHORDS;
  return chords.filter((c) => {
    const allowed = table[(((c.root - tonic) % 12) + 12) % 12];
    return !!allowed && (c.q === 'any' || allowed.includes(c.q));
  }).length;
}

/**
 * Om ackorden är skrivna som grepp för kapot – tonarten säger B men ackorden går i G med
 * kapo 4 – ges antalet halvtoner ackorden ska flyttas upp för att stämma med tonarten.
 * Annars 0.
 *
 * Ackorden jämförs med dem som hör till tonarten (dur eller moll på varje steg): minst tre
 * olika ackord, greppens grundton finns med, minst hälften hör till greppens tonart och fler
 * än till den angivna. Att dur och moll räknas gör att t.ex. ett C i D-dur (bVII) inte misstas
 * för grepp – C i C-dur passar, men D-dur är inte ett ackord i C-dur.
 */
export function capoShapeShift(song: ParsedSong): number {
  const capo = capoOf(song);
  if (!capo) return 0;
  const key = parseKey(song.meta.key, { hNotation: song.hNotation });
  if (!key) return 0;
  const seen = new Map<string, { root: number; q: Quality }>();
  for (const name of song.chords) {
    if (name.startsWith('*')) continue;
    const c = parseChord(name, { hNotation: song.hNotation });
    if (!c) continue;
    const chord = { root: ((c.root % 12) + 12) % 12, q: quality(c.suffix) };
    seen.set(`${chord.root}${chord.q}`, chord);
  }
  const chords = [...seen.values()];
  const n = chords.length;
  if (n < 3) return 0;
  const gripTonic = (((key.pc - capo) % 12) + 12) % 12;
  const inKey = fitsKey(chords, key.pc, key.minor);
  const asShapes = fitsKey(chords, gripTonic, key.minor);
  const tonicPresent = chords.some((c) => c.root === gripTonic);
  const clear = tonicPresent && asShapes > inKey && asShapes >= n / 2;
  return clear ? capo : 0;
}

/**
 * Skriver om ackord som är skrivna som grepp till de ackord som klingar, så att de stämmer
 * med tonarten. Kapot behålls, så att greppen visas som förut.
 */
export function shapesToSounding(source: string): string {
  const parsed = parseChordPro(source);
  const shift = capoShapeShift(parsed);
  if (!shift) return source;
  const key = parseKey(parsed.meta.key, { hNotation: parsed.hNotation })!;
  const moved = transposeSource(source, {
    transpose: shift,
    preferFlats: keyPrefersFlats(key.pc, key.minor),
    notation: parsed.hNotation ? 'swedish' : 'international',
  });
  // transposeSource flyttar även tonarterna, men de stämde redan (även tonartsbyten längre ner)
  const original = source.replace(/\r\n?/g, '\n').split('\n');
  const isKeyLine = (l: string) => {
    const d = l.trim().startsWith('{') ? parseDirective(l) : null;
    return !!d && (d.name === 'key' || (d.name === 'meta' && /^key\s/i.test(d.value.trim())));
  };
  return moved
    .split('\n')
    .map((l, i) => (isKeyLine(original[i] ?? '') ? original[i] : l))
    .join('\n');
}

export function songPrefersFlats(song: ParsedSong, transpose: number): boolean {
  let key = parseKey(song.meta.key, { hNotation: song.hNotation });
  if (!key && song.chords.length) {
    const c = parseChord(song.chords[0], { hNotation: song.hNotation });
    if (c) key = { pc: c.root, minor: isMinorSuffix(c.suffix) };
  }
  if (!key) return false;
  return keyPrefersFlats((((key.pc + transpose) % 12) + 12) % 12, key.minor);
}
