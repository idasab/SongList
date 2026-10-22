import { lyricsText, parseChordPro } from './chordpro';
import { formatKey, isMinorSuffix, parseChord, parseKey, type KeyInfo, type Notation } from './chords';
import type { Song } from './model';

/** Gemener och utan diakritiska tecken, så att "sang" hittar "Sång". */
export function normalizeForSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const lyricsCache = new Map<string, { at: number; text: string }>();

function songLyrics(song: Song): string {
  const c = lyricsCache.get(song.id);
  if (c && c.at === song.updatedAt) return c.text;
  const text = normalizeForSearch(lyricsText(song.content)).replace(/\s+/g, ' ');
  lyricsCache.set(song.id, { at: song.updatedAt, text });
  return text;
}

// --- Tonart ---

export interface SongKey {
  /** Tonklass 0–11 och moll/dur, med låtens transponering inräknad */
  key: KeyInfo;
  /** Sant om tonarten gissats från första ackordet (ingen {key:} i låten) */
  guessed: boolean;
}

const keyCache = new Map<string, { at: number; key: SongKey | null }>();

/** Låtens tonart som den visas: angiven tonart, annars första ackordet, plus transponering. */
export function songKey(song: Song): SongKey | null {
  const c = keyCache.get(song.id);
  if (c && c.at === song.updatedAt) return c.key;
  const parsed = parseChordPro(song.content);
  let base = parseKey(parsed.meta.key, { hNotation: parsed.hNotation });
  let guessed = false;
  if (!base) {
    const first = parsed.chords.map((ch) => parseChord(ch, { hNotation: parsed.hNotation })).find(Boolean);
    if (first) {
      base = { pc: first.root, minor: isMinorSuffix(first.suffix) };
      guessed = true;
    }
  }
  const key = base
    ? { key: { pc: (((base.pc + song.transpose) % 12) + 12) % 12, minor: base.minor }, guessed }
    : null;
  keyCache.set(song.id, { at: song.updatedAt, key });
  return key;
}

/** Id för en tonart som är oberoende av stavning, t.ex. "9m" för Am och "1" för C#/Db. */
export function keyId(k: KeyInfo): string {
  return `${k.pc}${k.minor ? 'm' : ''}`;
}

export function keyIdLabel(id: string, notation: Notation): string {
  const minor = id.endsWith('m');
  return formatKey({ pc: parseInt(id, 10), minor }, 0, notation);
}

/** Tonarterna som förekommer bland låtarna, i tonskalans ordning med dur före moll. */
export function keysInLibrary(songs: Song[]): string[] {
  const ids = new Set<string>();
  for (const s of songs) {
    const k = songKey(s);
    if (k) ids.add(keyId(k.key));
  }
  return [...ids].sort((a, b) => {
    const pa = parseInt(a, 10);
    const pb = parseInt(b, 10);
    return pa - pb || Number(a.endsWith('m')) - Number(b.endsWith('m'));
  });
}

export interface SongFilter {
  query: string;
  fullText: boolean;
  tags: string[];
  categoryId?: string;
  /** Tonart, se keyId() */
  keyId?: string;
}

export function filterSongs(songs: Song[], f: SongFilter): Song[] {
  const terms = normalizeForSearch(f.query).split(/\s+/).filter(Boolean);
  return songs.filter((s) => {
    if (f.categoryId && s.categoryId !== f.categoryId) return false;
    if (f.tags.length && !f.tags.every((t) => s.tags.includes(t))) return false;
    if (f.keyId) {
      const k = songKey(s);
      if (!k || keyId(k.key) !== f.keyId) return false;
    }
    if (!terms.length) return true;
    const head = normalizeForSearch(`${s.title} ${s.artist}`);
    const body = f.fullText ? songLyrics(s) : '';
    return terms.every((t) => head.includes(t) || (f.fullText && body.includes(t)));
  });
}

export function sortSongs(songs: Song[], by: 'title' | 'artist' | 'updated'): Song[] {
  const coll = new Intl.Collator('sv', { sensitivity: 'base', numeric: true });
  const list = [...songs];
  if (by === 'updated') list.sort((a, b) => b.updatedAt - a.updatedAt);
  else if (by === 'artist')
    list.sort((a, b) => coll.compare(a.artist || '￿', b.artist || '￿') || coll.compare(a.title, b.title));
  else list.sort((a, b) => coll.compare(a.title, b.title));
  return list;
}
