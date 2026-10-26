// Ackordteori: tolkning, transponering och formatering av ackordnamn.

export type Notation = 'international' | 'swedish';

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };

export interface ParsedChord {
  /** Tonklass 0–11 för grundtonen */
  root: number;
  /** Grundtonen som den skrevs, t.ex. "F#" */
  rootName: string;
  /** Allt mellan grundton och eventuell bas, t.ex. "m7", "sus4", "maj7(#11)" */
  suffix: string;
  bass?: number;
  bassName?: string;
  /** Text före/efter själva ackordet, t.ex. parenteser i "(Em)" */
  prefix: string;
  postfix: string;
}

export interface ParseOptions {
  /** Svensk notation i källan: H = B, B = Bb */
  hNotation?: boolean;
}

const NOTE_RE = /^([A-H])(#|b|♯|♭)?/;

/** Tolkar en tonbokstav med förtecken. Returnerar [tonklass, antal tecken som lästes]. */
function readNote(s: string, opts: ParseOptions): [number, number] | null {
  const m = NOTE_RE.exec(s);
  if (!m) return null;
  const letter = m[1];
  const acc = m[2] ?? '';
  // Svensk notation: B betyder Bb
  let pc = letter === 'B' && opts.hNotation ? 10 : LETTER_PC[letter];
  if (acc === '#' || acc === '♯') pc += 1;
  else if (acc === 'b' || acc === '♭') pc -= 1;
  return [(pc + 12) % 12, 1 + acc.length];
}

// Tillåtna byggstenar i ett ackordsuffix. Används för att skilja ackord från vanliga ord.
const SUFFIX_TOKEN_RES = [
  /^\d+/,
  /^(maj|min|dim|aug|sus|add|alt|omit|no)/,
  /^m[ai](?=\d)/,
  /^[mM]/,
  /^[°øΔ+\-#b♯♭(),^]/,
  /^\/(?=\d)/,
];

function isValidSuffix(suffix: string): boolean {
  let rest = suffix;
  while (rest.length > 0) {
    let matched = 0;
    for (const re of SUFFIX_TOKEN_RES) {
      const m = re.exec(rest);
      if (m) {
        matched = m[0].length;
        break;
      }
    }
    if (!matched) return false;
    rest = rest.slice(matched);
  }
  return true;
}

/** Tolkar ett ackordnamn, t.ex. "F#m7/C#". Returnerar null om det inte ser ut som ett ackord. */
export function parseChord(raw: string, opts: ParseOptions = {}): ParsedChord | null {
  if (!raw) return null;
  const m = /^([(\[]*)(.*?)([)\]]*)$/.exec(raw.trim());
  if (!m) return null;
  const [, prefix, core, postfix] = m;
  if (!core) return null;

  const rootRead = readNote(core, opts);
  if (!rootRead) return null;
  const [root, rootLen] = rootRead;
  const rootName = core.slice(0, rootLen);
  let rest = core.slice(rootLen);

  let bass: number | undefined;
  let bassName: string | undefined;
  const slash = rest.lastIndexOf('/');
  if (slash >= 0) {
    const bassPart = rest.slice(slash + 1);
    const bassRead = readNote(bassPart, opts);
    if (bassRead && bassRead[1] === bassPart.length) {
      bass = bassRead[0];
      bassName = bassPart;
      rest = rest.slice(0, slash);
    } else if (!/^\d+$/.test(bassPart)) {
      // Snedstreck följt av något annat än en ton eller siffra (t.ex. "6/9") – inte ett ackord.
      return null;
    }
  }
  if (!isValidSuffix(rest)) return null;
  return { root, rootName, suffix: rest, bass, bassName, prefix, postfix };
}

export function isChord(token: string, opts: ParseOptions = {}): boolean {
  return parseChord(token, opts) !== null;
}

export function pcName(pc: number, preferFlats: boolean, notation: Notation = 'international'): string {
  const name = (preferFlats ? FLAT_NAMES : SHARP_NAMES)[((pc % 12) + 12) % 12];
  return applyNotation(name, notation);
}

/** Konverterar ett internationellt tonnamn till svensk notation (B → H, Bb → B). */
function applyNotation(name: string, notation: Notation): string {
  if (notation !== 'swedish') return name;
  if (name === 'B') return 'H';
  if (name === 'Bb') return 'B';
  return name;
}

/** Normaliserar ett skrivet tonnamn till internationell stavning (behåller #/b). */
function normalizeNoteName(name: string, pc: number): string {
  const sharp = SHARP_NAMES[pc];
  const flat = FLAT_NAMES[pc];
  if (/[#♯]/.test(name)) return sharp;
  if (/[b♭]$/.test(name) || (name === 'B' && pc === 10)) return flat;
  return sharp.length === 1 ? sharp : flat;
}

// F# dur skrivs med korsförtecken (F#, B, C#7), som är vanligast för gitarrgrepp
const FLAT_MAJOR_KEYS = new Set([5, 10, 3, 8, 1]); // F Bb Eb Ab Db
const FLAT_MINOR_KEYS = new Set([2, 7, 0, 5, 10, 3]); // Dm Gm Cm Fm Bbm Ebm

/** Avgör om en tonart normalt skrivs med b-förtecken. */
export function keyPrefersFlats(keyPc: number, minor: boolean): boolean {
  return minor ? FLAT_MINOR_KEYS.has(keyPc) : FLAT_MAJOR_KEYS.has(keyPc);
}

export interface ChordContext {
  transpose: number;
  /** Om satt: använd b-förtecken (true) eller #-förtecken (false) vid transponering */
  preferFlats?: boolean;
  notation: Notation;
  hNotation?: boolean;
  /** Förenklade ackord: bara dur, moll eller förminskat, utan basstämma (Cmaj7 → C, G/B → G) */
  simplify?: boolean;
}

/** Ackordets typ i förenklad form: "m" för moll, "dim" för förminskat, annars dur. */
export function simplifySuffix(suffix: string): string {
  if (/^(dim|°|o$)/.test(suffix)) return 'dim';
  // Halvförminskat (ø, m7b5) spelas förenklat som moll
  return isMinorSuffix(suffix) || suffix.startsWith('ø') ? 'm' : '';
}

/** Formaterar ett ackord för visning, transponerat och i vald notation. */
export function formatChord(raw: string, ctx: ChordContext): string {
  if (raw.startsWith('*')) return raw.slice(1); // ChordPro-annotation, inte ett ackord
  const c = parseChord(raw, { hNotation: ctx.hNotation });
  if (!c) return raw;
  const t = ctx.transpose;
  let rootStr: string;
  let bassStr: string | undefined;
  if (t % 12 === 0) {
    rootStr = applyNotation(normalizeNoteName(c.rootName, c.root), ctx.notation);
    if (c.bass !== undefined && c.bassName) {
      bassStr = applyNotation(normalizeNoteName(c.bassName, c.bass), ctx.notation);
    }
  } else {
    const flats = ctx.preferFlats ?? false;
    rootStr = pcName(c.root + t, flats, ctx.notation);
    if (c.bass !== undefined) bassStr = pcName(c.bass + t, flats, ctx.notation);
  }
  // Slutparenteser utöver startparenteserna hör till ackordtypen, t.ex. "E7(b9)", och försvinner med den
  if (ctx.simplify) return `${c.prefix}${rootStr}${simplifySuffix(c.suffix)}${c.postfix.slice(0, c.prefix.length)}`;
  return `${c.prefix}${rootStr}${c.suffix}${bassStr ? '/' + bassStr : ''}${c.postfix}`;
}

export function isMinorSuffix(suffix: string): boolean {
  return /^(m(?!aj)|min|mi(?!d)|-)/.test(suffix);
}

export interface KeyInfo {
  pc: number;
  minor: boolean;
}

export function parseKey(key: string | undefined, opts: ParseOptions = {}): KeyInfo | null {
  if (!key) return null;
  const c = parseChord(key.trim().replace(/\s*(moll|minor)$/i, 'm').replace(/\s*(dur|major)$/i, ''), opts);
  if (!c) return null;
  return { pc: c.root, minor: isMinorSuffix(c.suffix) };
}

export function formatKey(key: KeyInfo, transpose: number, notation: Notation): string {
  const pc = (((key.pc + transpose) % 12) + 12) % 12;
  const flats = keyPrefersFlats(pc, key.minor);
  return pcName(pc, flats, notation) + (key.minor ? 'm' : '');
}

/** Normaliserar transponering till intervallet -6..+6 (för visning). */
export function normalizeTranspose(n: number): number {
  let t = ((n % 12) + 12) % 12;
  if (t > 6) t -= 12;
  return t;
}

/** Ser om en sång använder svensk H-notation (innehåller H-ackord). */
export function detectHNotation(chords: string[]): boolean {
  return chords.some((c) => /^[(\[]*H(?![a-z]{2})/.test(c) && parseChord(c) !== null);
}
