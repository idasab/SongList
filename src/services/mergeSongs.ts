// Slår ihop låtar som är sidor av samma noter till en låt med flera filer, och delar upp dem igen.

import { upsertDirective } from '../lib/chordpro';
import { mergeKey, pieceGroups, pieceTitle, samePieceTitles } from '../lib/fileGroups';
import { titleFromFileName } from '../lib/textImport';
import { songFiles, type Song } from '../lib/model';
import { liveSetlists, liveSongs, useStore } from '../store/useStore';

/**
 * Den första låten behålls och får de andras filer i tur och ordning (och deras taggar), utan
 * sidnummer i titeln. De andra raderas; i setlistor byts de mot den behållna låten, och finns
 * den redan i setlistan tas de bort där.
 */
export async function mergeSongs(ids: string[]): Promise<Song | undefined> {
  const st = useStore.getState();
  const list = [...new Set(ids)].map((id) => st.songs[id]).filter((s): s is Song => !!s && !s.deletedAt);
  const [keep, ...rest] = list;
  if (!keep || !rest.length) return keep;
  const others = new Set(rest.map((s) => s.id));
  // Sidnumret tas bort bara när låtarna är sidor av samma noter ("Låt (1)", "Låt (2)")
  const title = samePieceTitles(list.map((s) => s.title)) ? pieceTitle(keep.title) : keep.title;
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

/**
 * Gör låtens filer på de här platserna till egna låtar, med titeln efter filnamnet och samma
 * artist, taggar och kategori. Låten behåller resten av filerna (minst en) och sin plats i
 * setlistorna.
 */
export async function splitSongFiles(id: string, indexes: number[]): Promise<Song[]> {
  const st = useStore.getState();
  const song = st.songs[id];
  if (!song || song.deletedAt) return [];
  const files = songFiles(song);
  const out = new Set(indexes.filter((i) => i >= 0 && i < files.length));
  // Den första som stannar kvar: låten får aldrig bli utan filer
  if (out.size >= files.length) out.delete(0);
  if (!out.size) return [];
  const artist = song.artist ? `{artist: ${song.artist}}\n` : '';
  const created = await st.importSongs(
    files
      .filter((_, i) => out.has(i))
      .map((f) => ({ content: `{title: ${titleFromFileName(f.name)}}\n${artist}`, files: [f], tags: song.tags, categoryId: song.categoryId })),
  );
  await st.saveSong({ id, content: song.content, files: files.filter((_, i) => !out.has(i)) });
  // Uppdelat med flit: föreslå inte att slå ihop dem igen
  const now = useStore.getState();
  const involved = new Set([id, ...created.map((s) => s.id)]);
  const groups = pieceGroups(liveSongs(now.songs).map((s) => ({ ...s, isFile: !!s.attachment }))).filter((g) => g.some((s) => involved.has(s.id)));
  if (groups.length) await now.updateSettings({ dismissedMerges: [...(now.settings.dismissedMerges ?? []), ...groups.map(mergeKey)] });
  return created;
}
