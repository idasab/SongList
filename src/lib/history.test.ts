import { describe, expect, it } from 'vitest';
import { lastPlayed, songHistory, todayIso } from './history';
import type { Setlist, Song } from './model';

const song = (id: string, extra: Partial<Song> = {}): Song => ({ id, title: id, artist: '', content: '', tags: [], transpose: 0, createdAt: 1, updatedAt: 1, ...extra });
const sl = (id: string, songIds: string[], extra: Partial<Setlist> = {}): Setlist => ({
  id,
  name: id,
  items: songIds.map((s, i) => ({ id: `${id}-${i}`, songId: s, ...(s === '' ? { cue: 'Tal' } : {}) })),
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

describe('historik', () => {
  const songs = { a: song('a'), b: song('b'), gone: song('gone', { deletedAt: 2 }) };
  const setlists = {
    old: sl('old', ['a'], { date: '2026-03-01' }),
    future: sl('future', ['b', 'a'], { date: '2099-01-01' }),
    nodate: sl('nodate', ['a'], { updatedAt: 9 }),
    nodateOld: sl('nodateOld', ['a'], { updatedAt: 3 }),
    recent: sl('recent', ['gone', '', 'a'], { date: '2026-10-01' }),
    deleted: sl('deleted', ['a'], { date: '2026-10-20', deletedAt: 5 }),
    other: sl('other', ['b'], { date: '2026-10-22' }),
  };

  it('setlistor med låten: senaste datum först, odaterade sist', () => {
    const h = songHistory('a', setlists, songs);
    expect(h.map((x) => x.setlist.id)).toEqual(['future', 'recent', 'old', 'nodate', 'nodateOld']);
    // Platsen bland punkterna som visas: den raderade låten räknas inte, mellanpunkten gör det
    expect(h.find((x) => x.setlist.id === 'recent')!.index).toBe(1);
    expect(h.find((x) => x.setlist.id === 'future')!.index).toBe(1);
  });

  it('senast spelad: den senaste setlistan med ett datum som har varit', () => {
    const h = songHistory('a', setlists, songs);
    expect(lastPlayed(h, '2026-10-26')?.setlist.id).toBe('recent');
    expect(lastPlayed(h, '2026-03-01')?.setlist.id).toBe('old');
    expect(lastPlayed(h, '2026-01-01')).toBeUndefined();
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
