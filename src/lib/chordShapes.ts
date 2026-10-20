// Grepp för gitarr/ukulele (från chords-db) och toner för piano.

import { parseChord } from './chords';

export type Instrument = 'guitar' | 'ukulele' | 'piano';

export interface FretPosition {
  /** -1 = dämpad, 0 = öppen, annars band relativt baseFret */
  frets: number[];
  fingers: number[];
  baseFret: number;
  barres: number[];
}

interface DbChord {
  key: string;
  suffix: string;
  positions: FretPosition[];
}

interface ChordDb {
  main: { strings: number; fretsOnChord: number };
  chords: Record<string, DbChord[]>;
}

const dbCache: Partial<Record<'guitar' | 'ukulele', Promise<ChordDb>>> = {};

function loadDb(instrument: 'guitar' | 'ukulele'): Promise<ChordDb> {
  if (!dbCache[instrument]) {
    dbCache[instrument] =
      instrument === 'guitar'
        ? import('@tombatossals/chords-db/lib/guitar.json').then((m) => (m.default ?? m) as ChordDb)
        : import('@tombatossals/chords-db/lib/ukulele.json').then((m) => (m.default ?? m) as ChordDb);
  }
  return dbCache[instrument]!;
}

/** Översätter vanliga skrivsätt för suffix till databasens namn. */
export function normalizeSuffix(raw: string): string {
  let s = raw.replace(/[()]/g, '').replace(/♯/g, '#').replace(/♭/g, 'b').replace(/,/g, '');
  const table: Record<string, string> = {
    '': 'major',
    M: 'major',
    maj: 'major',
    m: 'minor',
    min: 'minor',
    mi: 'minor',
    '-': 'minor',
    M7: 'maj7',
    ma7: 'maj7',
    Δ: 'maj7',
    Δ7: 'maj7',
    j7: 'maj7',
    min7: 'm7',
    mi7: 'm7',
    '-7': 'm7',
    '°': 'dim',
    o: 'dim',
    '°7': 'dim7',
    o7: 'dim7',
    ø: 'm7b5',
    ø7: 'm7b5',
    '-7b5': 'm7b5',
    '+': 'aug',
    '#5': 'aug',
    '+5': 'aug',
    '7#5': 'aug7',
    '7+5': 'aug7',
    '+7': 'aug7',
    sus: 'sus4',
    '2': 'sus2',
    add2: 'add9',
    madd2: 'madd9',
    'm/maj7': 'mmaj7',
    mM7: 'mmaj7',
    minmaj7: 'mmaj7',
    '-maj7': 'mmaj7',
    '6/9': '69',
    'm6/9': 'm69',
    min6: 'm6',
    min9: 'm9',
    min11: 'm11',
    '7sus': '7sus4',
    sus7: '7sus4',
  };
  if (s in table) return table[s];
  s = s.replace(/^min/, 'm');
  return s;
}

const DB_KEY_NAMES: Record<number, string[]> = {
  0: ['C'],
  1: ['C#', 'Db', 'Csharp'],
  2: ['D'],
  3: ['Eb', 'D#'],
  4: ['E'],
  5: ['F'],
  6: ['F#', 'Gb', 'Fsharp'],
  7: ['G'],
  8: ['Ab', 'G#'],
  9: ['A'],
  10: ['Bb', 'A#'],
  11: ['B'],
};

const BASS_NAMES: Record<number, string[]> = {
  0: ['C'],
  1: ['C#', 'Db'],
  2: ['D'],
  3: ['D#', 'Eb'],
  4: ['E'],
  5: ['F'],
  6: ['F#', 'Gb'],
  7: ['G'],
  8: ['G#', 'Ab'],
  9: ['A'],
  10: ['Bb', 'A#'],
  11: ['B'],
};

export interface FrettedShapes {
  strings: number;
  positions: FretPosition[];
  /** Sant om vi visar ett närliggande ackord (t.ex. utan basen i ett snedstrecksackord) */
  approximate: boolean;
}

export async function getFrettedShapes(
  instrument: 'guitar' | 'ukulele',
  chordName: string,
  hNotation = false,
): Promise<FrettedShapes | null> {
  const c = parseChord(chordName, { hNotation });
  if (!c) return null;
  const db = await loadDb(instrument);
  let list: DbChord[] | undefined;
  for (const k of DB_KEY_NAMES[c.root]) {
    if (db.chords[k]) {
      list = db.chords[k];
      break;
    }
  }
  if (!list) {
    // Databasen indexerar ibland på andra namn – leta på varje posts "key"
    const names = DB_KEY_NAMES[c.root];
    list = Object.values(db.chords).find((arr) => arr.length && names.includes(arr[0].key));
  }
  if (!list) return null;
  const suffix = normalizeSuffix(c.suffix);
  const candidates: string[] = [];
  if (c.bass !== undefined && c.bass !== c.root) {
    const base = suffix === 'major' ? '' : suffix === 'minor' ? 'm' : suffix;
    for (const b of BASS_NAMES[c.bass]) candidates.push(`${base}/${b}`);
  }
  candidates.push(suffix);
  for (let k = 0; k < candidates.length; k++) {
    const found = list.find((e) => e.suffix === candidates[k]);
    if (found) {
      return {
        strings: db.main.strings,
        positions: found.positions,
        approximate: c.bass !== undefined && c.bass !== c.root && k === candidates.length - 1,
      };
    }
  }
  return null;
}

// --- Piano ---

const INTERVALS: Record<string, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  '5': [0, 7],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  '7sus2': [0, 2, 7, 10],
  aug: [0, 4, 8],
  '6': [0, 4, 7, 9],
  '69': [0, 4, 7, 9, 14],
  '7': [0, 4, 7, 10],
  '7b5': [0, 4, 6, 10],
  aug7: [0, 4, 8, 10],
  '9': [0, 4, 7, 10, 14],
  '9b5': [0, 4, 6, 10, 14],
  aug9: [0, 4, 8, 10, 14],
  '7b9': [0, 4, 7, 10, 13],
  '7#9': [0, 4, 7, 10, 15],
  '11': [0, 4, 7, 10, 14, 17],
  '9#11': [0, 4, 7, 10, 14, 18],
  '13': [0, 4, 7, 10, 14, 21],
  maj7: [0, 4, 7, 11],
  maj7b5: [0, 4, 6, 11],
  'maj7#5': [0, 4, 8, 11],
  maj9: [0, 4, 7, 11, 14],
  maj11: [0, 4, 7, 11, 14, 17],
  maj13: [0, 4, 7, 11, 14, 21],
  m6: [0, 3, 7, 9],
  m69: [0, 3, 7, 9, 14],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  m9: [0, 3, 7, 10, 14],
  m11: [0, 3, 7, 10, 14, 17],
  mmaj7: [0, 3, 7, 11],
  mmaj7b5: [0, 3, 6, 11],
  mmaj9: [0, 3, 7, 11, 14],
  mmaj11: [0, 3, 7, 11, 14, 17],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  add11: [0, 4, 7, 17],
  add4: [0, 4, 5, 7],
};

export interface PianoChord {
  /** Absoluta tonhöjder (0 = C i första oktaven som visas) */
  notes: number[];
  bass?: number;
  octaves: number;
}

export function getPianoChord(chordName: string, hNotation = false): PianoChord | null {
  const c = parseChord(chordName, { hNotation });
  if (!c) return null;
  const intervals = INTERVALS[normalizeSuffix(c.suffix)];
  if (!intervals) return null;
  const notes = intervals.map((i) => c.root + i);
  let bass: number | undefined;
  if (c.bass !== undefined && c.bass !== c.root) {
    // Basen läggs under ackordet; flytta upp ackordet en oktav
    for (let i = 0; i < notes.length; i++) notes[i] += 12;
    bass = c.bass <= c.root ? c.bass + 12 : c.bass;
    if (bass >= notes[0]) bass -= 12;
  }
  const max = Math.max(...notes);
  return { notes, bass, octaves: Math.max(2, Math.ceil((max + 1) / 12)) };
}
