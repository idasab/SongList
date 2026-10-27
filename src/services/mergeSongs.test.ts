import { describe, expect, it, vi } from 'vitest';
import type { SongAttachment } from '../lib/model';

vi.mock('../store/db', () => {
  const noop = async () => undefined;
  const table = { all: async () => [], put: noop, putMany: noop, clear: noop };
  return {
    requestPersistentStorage: noop,
    db: { songs: table, setlists: table, categories: table, folders: table, saveSettings: noop, getSettings: noop, getDeviceId: async () => 't', isFirstRun: async () => false },
  };
});

const { useStore } = await import('../store/useStore');
const { mergeSongs, splitSongFiles } = await import('./mergeSongs');
const { songFiles } = await import('../lib/model');

const file = (name: string): SongAttachment => ({ name, mime: 'application/pdf', dataUrl: `data:application/pdf;base64,${name}`, kind: 'pdf' });

describe('slå ihop låtar', () => {
  it('behåller den första låten med allas filer och byter dem i setlistor', async () => {
    useStore.setState({ songs: {}, setlists: {} });
    const st = useStore.getState();
    const a1 = await st.saveSong({ content: '{title: Låt (1)}\n', attachment: file('a1'), tags: ['jul'] });
    const a2 = await st.saveSong({ content: '{title: Låt (2)}\n', attachment: file('a2'), tags: ['advent'] });
    const a3 = await st.saveSong({ content: '{title: Låt (3)}\n', files: [file('a3'), file('a3b')] });
    const other = await st.saveSong({ content: '{title: Annan}\n' });
    const item = (id: string, songId: string) => ({ id, songId });
    const both = await st.saveSetlist({ name: 'Båda', items: [item('1', a1.id), item('2', other.id), item('3', a2.id)] });
    const onlySecond = await st.saveSetlist({ name: 'Andra', items: [item('1', a2.id), item('2', a3.id)] });

    const merged = await mergeSongs([a1.id, a2.id, a3.id]);
    const s = useStore.getState();
    expect(merged!.id).toBe(a1.id);
    expect(s.songs[a1.id].title).toBe('Låt');
    expect(songFiles(s.songs[a1.id]).map((f) => f.name)).toEqual(['a1', 'a2', 'a3', 'a3b']);
    expect(s.songs[a1.id].tags).toEqual(['jul', 'advent']);
    expect(s.songs[a2.id].deletedAt).toBeDefined();
    expect(s.songs[a3.id].deletedAt).toBeDefined();
    // Fanns låten redan i setlistan tas de andra bort; annars blir den första av dem låten
    expect(s.setlists[both.id].items.map((it) => it.songId)).toEqual([a1.id, other.id]);
    expect(s.setlists[onlySecond.id].items.map((it) => it.songId)).toEqual([a1.id]);
  });
});

describe('slå ihop olika låtar', () => {
  it('behåller titeln när låtarna inte är sidor av samma noter, och samma id två gånger raderar inget', async () => {
    useStore.setState({ songs: {}, setlists: {} });
    const st = useStore.getState();
    const a = await st.saveSong({ content: '{title: Gudstjänst 2024-06-02}\n', attachment: file('a') });
    const b = await st.saveSong({ content: '{title: Extra}\n', attachment: file('b') });
    await mergeSongs([a.id, b.id]);
    expect(useStore.getState().songs[a.id].title).toBe('Gudstjänst 2024-06-02');
    await mergeSongs([a.id, a.id]);
    expect(useStore.getState().songs[a.id].deletedAt).toBeUndefined();
    expect(songFiles(useStore.getState().songs[a.id])).toHaveLength(2);
  });
});

describe('dela upp en låt med flera filer', () => {
  it('gör filerna till egna låtar och föreslår inte att slå ihop dem igen', async () => {
    useStore.setState({ songs: {}, setlists: {} });
    const st = useStore.getState();
    const song = await st.saveSong({
      content: '{title: Låt}\n{artist: Prov}\n',
      files: [file('Låt (1).pdf'), file('Låt (2).pdf'), file('Låt (3).pdf')],
      tags: ['jul'],
    });
    const made = await splitSongFiles(song.id, [1, 2]);
    const s = useStore.getState();
    expect(made.map((m) => m.title)).toEqual(['Låt (2)', 'Låt (3)']);
    expect(made.every((m) => m.artist === 'Prov' && m.tags.includes('jul'))).toBe(true);
    expect(songFiles(s.songs[song.id]).map((f) => f.name)).toEqual(['Låt (1).pdf']);
    expect(s.settings.dismissedMerges?.length).toBe(1);
  });

  it('låten behåller alltid minst en fil', async () => {
    useStore.setState({ songs: {}, setlists: {} });
    const song = await useStore.getState().saveSong({ content: '{title: X}\n', files: [file('a'), file('b')] });
    const made = await splitSongFiles(song.id, [0, 1]);
    expect(made).toHaveLength(1);
    expect(songFiles(useStore.getState().songs[song.id]).map((f) => f.name)).toEqual(['a']);
  });
});
