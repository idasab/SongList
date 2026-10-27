// En {subtitle} som egentligen är artisten (vanligt i ChordPro-filer från andra appar, och så
// tolkade SongList själv undertiteln förut). Appen frågar om den ska flyttas till artist.

import { upsertDirective } from './chordpro';
import type { Song } from './model';

// Småord som får stå med liten bokstav i ett namn ("Simon and Garfunkel", "Bob Marley & the Wailers")
const SMALL_WORDS = new Set(['&', '+', 'and', 'och', 'the', 'of', 'feat.', 'feat', 'ft.', 'med', 'de', 'la', 'van', 'von', 'der', 'den', 'det']);

/** Ser ut som ett namn: några ord med stor bokstav, inga siffror eller meningstecken. */
export function looksLikeArtist(subtitle: string): boolean {
  const s = subtitle.trim();
  if (!s || s.length > 40 || /[\d:;!?"„”“()[\]{}]/.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length > 5) return false;
  const capital = (w: string) => /^\p{Lu}/u.test(w);
  return words.some(capital) && words.every((w) => capital(w) || SMALL_WORDS.has(w.toLowerCase()));
}

/** Ska appen fråga om låtens undertitel är artisten? (Inte om man redan svarat nej för den.) */
export function askSubtitleArtist(song: Pick<Song, 'subtitle' | 'artist' | 'subtitleNotArtist'>): boolean {
  return (
    !!song.subtitle && !song.artist.trim() && song.subtitleNotArtist !== song.subtitle && looksLikeArtist(song.subtitle)
  );
}

/** Låtens text med undertiteln som artist i stället. */
export function subtitleToArtist(content: string, subtitle: string): string {
  return upsertDirective(upsertDirective(content, 'subtitle', ''), 'artist', subtitle);
}
