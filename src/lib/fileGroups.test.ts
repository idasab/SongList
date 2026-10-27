import { describe, expect, it } from 'vitest';
import { filePageNumber, groupHeads, joinsPrevious, pieceGroups, pieceTitle, samePiece, sortByPage } from './fileGroups';
import { filesFields, sanitizeLibrary, songFiles, type LibraryData, type SongAttachment } from './model';
import { markMissingAttachments, referencedFiles } from './backupFiles';

const file = (name: string, dataUrl = `data:application/pdf;base64,${name}`): SongAttachment => ({
  name,
  mime: 'application/pdf',
  dataUrl,
  kind: 'pdf',
});

describe('sidor av samma noter', () => {
  it('känner igen sidnummer i filnamn', () => {
    expect(filePageNumber('Låt (2).pdf')).toBe(2);
    expect(filePageNumber('Låt sida 3.pdf')).toBe(3);
    expect(filePageNumber('Låt - del 2.pdf')).toBe(2);
    expect(filePageNumber('Låt_4.pdf')).toBe(4);
    expect(filePageNumber('Låt p2.pdf')).toBe(2);
    // Inte en del av ett ord, och inte ett nummer i titeln
    expect(filePageNumber('Help2.pdf')).toBeUndefined();
    expect(filePageNumber('Psalm 23.pdf')).toBeUndefined();
  });

  it('samma låt bara när namnen skiljer sig på sidnumret', () => {
    expect(samePiece('Låt (1).pdf', 'Låt (2).pdf')).toBe(true);
    expect(samePiece('Låt.pdf', 'Låt (2).pdf')).toBe(true);
    expect(samePiece('Låt (1).pdf', 'Annan (2).pdf')).toBe(false);
    // Samma namn utan sidnummer är snarare en kopia
    expect(samePiece('Låt.pdf', 'Låt.pdf')).toBe(false);
    expect(samePiece('Psalm 23.pdf', 'Psalm 24.pdf')).toBe(false);
  });

  it('grupperar filer i importlistan, med val för hand', () => {
    const items = [
      { fileName: 'A (1).pdf', isFile: true },
      { fileName: 'A (2).pdf', isFile: true },
      { fileName: 'A (3).pdf', isFile: true },
      { fileName: 'B (1).pdf', isFile: true },
      { fileName: 'scan.pdf', isFile: true, joinPrev: true },
      { fileName: 'B (2).pdf', isFile: false },
    ];
    expect(joinsPrevious(items)).toEqual([false, true, true, false, true, false]);
    expect(groupHeads(items)).toEqual([0, 0, 0, 3, 3, 5]);
    // Valt bort för hand
    expect(groupHeads([items[0], { ...items[1], joinPrev: false }])).toEqual([0, 1]);
  });

  it('sorterar filer efter sidnummer när alla har ett', () => {
    expect(sortByPage([file('A (2).pdf'), file('A (1).pdf')]).map((f) => f.name)).toEqual(['A (1).pdf', 'A (2).pdf']);
    // En fil utan nummer bland numrerade är första sidan (som appens egen export "A (sida 2).pdf")
    expect(sortByPage([file('A (sida 2).pdf'), file('A.pdf')]).map((f) => f.name)).toEqual(['A.pdf', 'A (sida 2).pdf']);
    expect(sortByPage([file('A.pdf'), file('B.pdf')]).map((f) => f.name)).toEqual(['A.pdf', 'B.pdf']);
  });

  it('räknar inte bildnummer, datum och namn med siffror som sidor', () => {
    expect(filePageNumber('IMG_1234.jpg')).toBeUndefined();
    expect(filePageNumber('Gudstjänst 2024-06-02.pdf')).toBeUndefined();
    expect(filePageNumber('Blink-182.pdf')).toBeUndefined();
    expect(filePageNumber('Låt (sida 2).pdf')).toBe(2);
    expect(filePageNumber('Låt_2.pdf')).toBe(2);
    expect(samePiece('IMG_1234.jpg', 'IMG_1235.jpg')).toBe(false);
    expect(samePiece('Låt.pdf', 'Låt (sida 2).pdf')).toBe(true);
  });

  it('samma filer valda två gånger blir inte fler sidor', () => {
    const f = (fileName: string) => ({ fileName, isFile: true });
    expect(joinsPrevious([f('Låt (1).pdf'), f('Låt (2).pdf'), f('Låt (1).pdf'), f('Låt (2).pdf')])).toEqual([false, true, false, true]);
    expect(joinsPrevious([f('Låt (2).pdf'), f('Låt (2).pdf')])).toEqual([false, false]);
  });

  it('hittar låtar i biblioteket som är sidor av samma noter', () => {
    const s = (id: string, title: string, artist = '', isFile = true) => ({ id, title, artist, isFile });
    const groups = pieceGroups([
      s('a2', 'Låt (2)'),
      s('a1', 'Låt (1)'),
      s('t', 'Låt (3)', '', false),
      s('b1', 'Annan (1)', 'X'),
      s('b2', 'Annan (2)', 'Y'),
      s('c1', 'Kopia (1)'),
      s('c2', 'Kopia (1)'),
    ]);
    expect(groups.map((g) => g.map((x) => x.id))).toEqual([['a1', 'a2']]);
    expect(pieceTitle('Låt (2)')).toBe('Låt');
  });
});

describe('flera filer i en låt', () => {
  it('första filen och resten', () => {
    const [a, b, c] = [file('a'), file('b'), file('c')];
    expect(filesFields([a, b, c])).toEqual({ attachment: a, extraAttachments: [b, c] });
    expect(filesFields([a])).toEqual({ attachment: a, extraAttachments: undefined });
    expect(songFiles(filesFields([a, b]))).toEqual([a, b]);
    expect(songFiles({})).toEqual([]);
  });

  it('rensar trasiga filer från synk och flyttar upp nästa', () => {
    const data = sanitizeLibrary({
      songs: [
        { id: 's', updatedAt: 1, title: 'S', content: '', attachment: { name: 'x' }, extraAttachments: [file('b'), null, file('c')] },
      ],
      setlists: [],
      categories: [],
      folders: [],
    } as unknown as LibraryData);
    expect(songFiles(data.songs[0]).map((f) => f.name)).toEqual(['b', 'c']);
  });

  it('säkerhetskopior: alla filer räknas, saknade tas bort var för sig', () => {
    const backup = {
      songs: [{ id: 's', title: 'S', content: '{title: S}', ...filesFields([{ ...file('a', ''), file: 'h1.pdf' }, file('b')]) }],
      setlists: [],
      categories: [],
    } as never;
    expect(referencedFiles({ songs: [{ ...filesFields([{ ...file('a'), file: 'h1.pdf' }, { ...file('b'), file: 'h2.pdf' }]) }] } as never)).toEqual([
      'h1.pdf',
      'h2.pdf',
    ]);
    const fixed = markMissingAttachments(backup);
    expect(songFiles(fixed.songs[0]).map((f) => f.name)).toEqual(['b']);
    expect(fixed.songs[0].content).toContain('Originalfilen a saknas');
  });
});
