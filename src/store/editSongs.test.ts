import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => {
  const noop = async () => undefined;
  const table = { all: async () => [], put: noop, putMany: noop, clear: noop };
  return {
    requestPersistentStorage: noop,
    db: { songs: table, setlists: table, categories: table, folders: table, saveSettings: noop, getSettings: noop, getDeviceId: async () => 't', isFirstRun: async () => false },
  };
});

const { useStore } = await import('./useStore');

async function setup() {
  useStore.setState({ songs: {}, categories: {} });
  const st = useStore.getState();
  const a = await st.saveSong({ content: '{title: A}', tags: ['jul'] });
  const b = await st.saveSong({ content: '{title: B}' });
  const gone = await st.saveSong({ content: '{title: C}' });
  await st.deleteSong(gone.id);
  const psalm = await st.saveCategory({ name: 'Psalmer' });
  const old = await st.saveCategory({ name: 'Gammal' });
  await st.deleteCategory(old.id);
  return { a, b, gone, psalm, old };
}

describe('ändra flera låtar', () => {
  it('lägger till taggar utan att ta bort andra eller dubblera', async () => {
    const { a, b, gone } = await setup();
    const n = await useStore.getState().editSongs([a.id, b.id, gone.id, 'saknas'], { addTags: ['Jul', 'advent'] });
    const songs = useStore.getState().songs;
    expect(n).toBe(2);
    expect(songs[a.id].tags).toEqual(['jul', 'advent']);
    expect(songs[b.id].tags).toEqual(['jul', 'advent']);
    // Raderade låtar rörs inte
    expect(songs[gone.id].tags).toEqual([]);
    expect(songs[a.id].content).toBe('{title: A}');
  });

  it('sätter och tar bort kategori, men aldrig en raderad', async () => {
    const { a, b, psalm, old } = await setup();
    const st = useStore.getState();
    expect(await st.editSongs([a.id, b.id], { categoryId: psalm.id })).toBe(2);
    expect(useStore.getState().songs[b.id].categoryId).toBe(psalm.id);
    // Ingen ändring: räknas inte
    expect(await st.editSongs([a.id], { categoryId: psalm.id })).toBe(0);
    await st.editSongs([a.id], { categoryId: old.id });
    expect(useStore.getState().songs[a.id].categoryId).toBeUndefined();
    await st.editSongs([b.id], { categoryId: null });
    expect(useStore.getState().songs[b.id].categoryId).toBeUndefined();
    expect(useStore.getState().songs[b.id].tags).toEqual([]);
  });
});

describe('svaret om undertiteln', () => {
  it('står kvar när låten sparas igen', async () => {
    const { a } = await setup();
    const st = useStore.getState();
    await st.updateSongPrefs(a.id, { subtitleNotArtist: 'X' });
    await st.saveSong({ id: a.id, content: '{title: A2}' });
    expect(useStore.getState().songs[a.id].subtitleNotArtist).toBe('X');
  });
});
