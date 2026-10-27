// Slår ihop låtar som är sidor av samma noter till en låt med flera filer.

import { upsertDirective } from '../lib/chordpro';
import { pieceTitle } from '../lib/fileGroups';
import { songFiles, type Song } from '../lib/model';
import { liveSetlists, useStore } from '../store/useStore';

/**
 * Den första låten behålls och får de andras filer i tur och ordning (och deras taggar), utan
 * sidnummer i titeln. De andra raderas; i setlistor byts de mot den behållna låten, och finns
 * den redan i setlistan tas de bort där.
 */
export async function mergeSongs(ids: string[]): Promise<Song | undefined> {
  const st = useStore.getState();
  const list = ids.map((id) => st.songs[id]).filter((s): s is Song => !!s && !s.deletedAt);
  const [keep, ...rest] = list;
  if (!keep || !rest.length) return keep;
  const others = new Set(rest.map((s) => s.id));
  const title = pieceTitle(keep.title);
  const saved = await st.saveSong({
    id: keep.id,
    content: title === keep.title ? keep.content : upsertDirective(keep.content, 'title', title),
    files: list.flatMap(songFiles),
    tags: list.flatMap((s) => s.tags),
    categoryId: keep.categoryId ?? rest.find((s) => s.categoryId)?.categoryId,
  });
  for (const sl of liveSetlists(useStore.getState().setlists)) {
    if (!sl.items.some((it) => others.has(it.songId))) continue;
    const had = sl.items.some((it) => it.songId === keep.id);
    let seen = had;
    const items = sl.items.flatMap((it) => {
      if (!others.has(it.songId)) return [it];
      // Första förekomsten av de sammanslagna låtarna blir den behållna låten
      if (seen) return [];
      seen = true;
      return [{ ...it, songId: keep.id }];
    });
    await st.saveSetlist({ ...sl, items });
  }
  for (const s of rest) await st.deleteSong(s.id);
  return saved;
}
