import { lyricsText } from './chordpro';
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

export interface SongFilter {
  query: string;
  fullText: boolean;
  tags: string[];
  categoryId?: string;
}

export function filterSongs(songs: Song[], f: SongFilter): Song[] {
  const terms = normalizeForSearch(f.query).split(/\s+/).filter(Boolean);
  return songs.filter((s) => {
    if (f.categoryId && s.categoryId !== f.categoryId) return false;
    if (f.tags.length && !f.tags.every((t) => s.tags.includes(t))) return false;
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
