import { describe, expect, it, vi } from 'vitest';
import type { Setlist, Song } from '../lib/model';

vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: async () => undefined }), getLaunchUrl: async () => undefined } }));
vi.mock('../store/db', () => {
  const noop = async () => undefined;
  const table = { all: async () => [], put: noop, putMany: noop, clear: noop };
  return {
    requestPersistentStorage: noop,
    db: { songs: table, setlists: table, categories: table, folders: table, saveSettings: noop, getSettings: noop, getDeviceId: async () => 't', isFirstRun: async () => false },
  };
});

const { useStore } = await import('../store/useStore');
const { buildSharedSetlist, importSharedSetlist, parseSharedSetlist } = await import('./setlistShare');

const song = (id: string, extra: Partial<Song> = {}): Song => ({
  id,
  title: id,
  artist: '',
  content: `{title: ${id}}\n[C]Påhittad rad`,
  tags: [],
  transpose: 0,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

describe('dela setlista', () => {
  it('från avsändarens setlista till mottagarens bibliotek', async () => {
    const pdf = { kind: 'pdf' as const, mime: 'application/pdf', name: 'n.pdf', dataUrl: 'data:application/pdf;base64,QQ==' };
    const sender: Record<string, Song> = {
      a: song('a', { transpose: 2, tags: ['jul'], annotations: { strokes: [], notes: [] } }),
      b: song('b', { content: '{title: b}\n', attachment: pdf }),
      c: song('c', { transpose: 1 }),
      gone: song('gone', { deletedAt: 5 }),
    };
    const setlist: Setlist = {
      id: 's',
      name: 'Spelning',
      date: '2026-11-01',
      createdAt: 1,
      updatedAt: 1,
      items: [
        { id: '1', songId: 'a', transpose: 5 },
        { id: '2', songId: '', cue: 'Tal' },
        { id: '3', songId: 'b' },
        { id: '4', songId: 'gone' },
        { id: '5', songId: 'c' },
      ],
    };
    const file = JSON.stringify(buildSharedSetlist(setlist, sender));
    expect(file).not.toContain('annotations');
    const shared = parseSharedSetlist(file)!;
    expect(shared.songs.map((s) => s.id)).toEqual(['a', 'b', 'c']);

    // Mottagaren har redan samma fil (b) och samma låt c men otransponerad
    useStore.setState({ songs: {}, setlists: {} });
    const mineB = await useStore.getState().saveSong({ content: '{title: b}\n', attachment: pdf });
    await useStore.getState().saveSong({ id: 'c', content: sender.c.content });
    const sl = await importSharedSetlist(shared);

    const songs = useStore.getState().songs;
    const live = Object.values(songs).filter((s) => !s.deletedAt);
    expect(live).toHaveLength(3);
    expect(sl.name).toBe('Spelning');
    expect(sl.date).toBe('2026-11-01');
    const [a, cue, b, c] = sl.items;
    expect(songs[a.songId]).toMatchObject({ title: 'a', transpose: 2, tags: ['jul'] });
    expect(a.transpose).toBe(5);
    expect(cue).toMatchObject({ songId: '', cue: 'Tal' });
    expect(b.songId).toBe(mineB.id);
    // Mottagarens c är inte transponerad: setlistan får avsändarens tonart
    expect(c).toMatchObject({ songId: 'c', transpose: 1 });
    expect(songs.c.transpose).toBe(0);
  });

  it('tonarter i filen blir heltal i rätt intervall', () => {
    const file = {
      format: 'songlist-setlist',
      version: 1,
      setlist: { name: 'x', items: [{ songId: 'a', transpose: 7 }, { songId: 'a', transpose: 1.5 }] },
      songs: [{ id: 'a', title: 'a', artist: '', content: '', tags: [], transpose: -7 }],
    };
    const shared = parseSharedSetlist(JSON.stringify(file))!;
    expect(shared.setlist.items.map((it) => it.transpose)).toEqual([-5, undefined]);
    expect(shared.songs[0].transpose).toBe(5);
  });

  it('läser inte andra filer', () => {
    expect(parseSharedSetlist('inte json')).toBeNull();
    expect(parseSharedSetlist(JSON.stringify({ format: 'annat' }))).toBeNull();
  });
});
