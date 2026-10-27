import { describe, expect, it } from 'vitest';
import { findDuplicates, pageNumber, titleKey } from './duplicates';
import type { Song } from './model';

const song = (id: string, title: string, artist = '', content = `{title: ${title}}\n[C]Påhittad rad`, extra: Partial<Song> = {}): Song => ({
  id,
  title,
  artist,
  content,
  tags: [],
  transpose: 0,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

describe('dubbletter', () => {
  it('jämför titlar utan skiftläge, skiljetecken och siffra i parentes', () => {
    expect(titleKey('Allt som Herren gjort - D (2)')).toBe('allt som herren gjort d');
    expect(titleKey('Ära  vare Gud!')).toBe(titleKey('ära vare gud'));
    expect(pageNumber('Låt (2)')).toBe(2);
    expect(pageNumber('Låt')).toBeUndefined();
  });

  it('en sida som redan finns som fil nummer två i en låt är likadan', () => {
    const f = (n: string) => ({ kind: 'pdf' as const, mime: 'application/pdf', name: `${n}.pdf`, dataUrl: `data:${n}` });
    const lib = [song('a', 'Låt', '', '{title: Låt}\n', { attachment: f('p1'), extraAttachments: [f('p2')] })];
    const [d] = findDuplicates([{ title: 'Låt (2)', artist: '', content: '', fileData: 'data:p2' }], lib);
    expect(d?.identical).toBe(true);
    // Hela gruppen jämförs: en ny sida gör den olik
    const [e] = findDuplicates([{ title: 'Låt (1)', artist: '', content: '', files: ['data:p1', 'data:p3'] }], lib);
    expect(e?.identical).toBe(false);
  });

  it('hittar likadana låtar, olika versioner och andra sidor', () => {
    const lib = [
      song('a', 'Påhittad visa', 'Någon'),
      song('b', 'Noter - D (1)', '', '{title: Noter - D (1)}\n', { attachment: { kind: 'pdf', mime: 'application/pdf', name: 'n.pdf', dataUrl: 'data:1' } }),
      song('c', 'Raderad', '', '{title: Raderad}\n', { deletedAt: 5 }),
    ];
    const [same, other, otherArtist, page2, samePdf, deleted, batchCopy] = findDuplicates(
      [
        { title: 'Påhittad visa', artist: 'Någon', content: lib[0].content },
        { title: 'påhittad VISA', artist: '', content: '{title: påhittad VISA}\n[G]Annan rad' },
        { title: 'Påhittad visa', artist: 'Någon annan', content: 'x' },
        { title: 'Noter - D (2)', artist: '', content: '', fileData: 'data:2' },
        { title: 'Noter - D (1)', artist: '', content: '', fileData: 'data:1' },
        { title: 'Raderad', artist: '', content: '{title: Raderad}\n' },
        { title: 'Raderad', artist: '', content: 'y' },
      ],
      lib,
    );
    expect(same).toMatchObject({ song: { id: 'a' }, identical: true, otherPage: false });
    expect(other).toMatchObject({ song: { id: 'a' }, identical: false });
    // Annan artist: inte låten i biblioteket (men kopian utan artist tidigare i importen)
    expect(otherArtist?.song).toBeUndefined();
    expect(otherArtist?.title).toBe('påhittad VISA');
    expect(page2).toMatchObject({ song: { id: 'b' }, identical: false, otherPage: true });
    expect(samePdf).toMatchObject({ song: { id: 'b' }, identical: true });
    // Raderade låtar räknas inte, men en kopia i samma import gör det
    expect(deleted).toBeUndefined();
    expect(batchCopy).toMatchObject({ title: 'Raderad', identical: false });
    expect(batchCopy?.song).toBeUndefined();
  });

  it('två likadana kopior av en ny version: den andra är en likadan dubblett', () => {
    const lib = [song('a', 'Visa', '', '{title: Visa}\n[C]Gammal')];
    const v2 = { title: 'Visa', artist: '', content: '{title: Visa}\n[G]Ny' };
    const [first, second] = findDuplicates([v2, v2], lib);
    expect(first).toMatchObject({ song: { id: 'a' }, identical: false });
    expect(second).toMatchObject({ identical: true });
    expect(second?.song).toBeUndefined();
  });
});
