import { describe, expect, it } from 'vitest';
import { CUE_ROUTE_ID, itemPath, itemTitle, itemTranspose, liveItems, moveVisible, songCount } from './setlist';
import { sanitizeLibrary, type BackupFile, type Setlist, type Song } from './model';
import { pdfSafe } from './pdfText';
import { attachmentFileName, contentHash, dataUrlBase64, markMissingAttachments, referencedFiles } from './backupFiles';
import { songFileNames } from '../services/songFiles';
import { deriveSongMeta } from '../store/useStore';
import { unzipSync, zipSync } from 'fflate';
import { decodeZipName, zipNameMap } from './zipNames';
import { formatChord, isChord, parseChord, parseKey, formatKey } from './chords';
import { capoOf, capoShapeShift, displayChordContext, formatDuration, isChordRow, parseDuration, shapesToSounding, midWordBreaks, parseChordPro, parseLyricsLine, splitWords, transposeSource, upsertDirective } from './chordpro';
import { isChordLine, parseHeader } from './layout';
import { decodeText, isChordProFileName, looksLikeChordPro, textToChordPro, titleFromFileName, type Measure } from './textImport';
import { ocrToChordPro, type OcrPage } from './ocrLayout';
import { getPianoChord, normalizeSuffix } from './chordShapes';
import { mergeRecords, restoreMerge } from './merge';
import { anchorAt, anchorToPx, clampNoteCenter, hitStroke, strokeFromPx, strokeToPx } from './annotations';
import { buildChordProExport, buildPdfExport, buildSongFiles, buildTextExport, mailBody, mailSubject } from '../services/setlistExport';
import { isValidEmail } from '../services/mail';
import { filterSongs, groupLetter, keyId, keyIdLabel, keysInLibrary, songKey, sortSongs } from './search';

describe('ackord', () => {
  it('förenklade ackord: bara dur, moll och förminskat, utan bas', () => {
    const ctx = { transpose: 0, notation: 'international' as const, simplify: true };
    const out = ['Cmaj7', 'Dsus4', 'G/B', 'Am7', 'F#m7b5', 'E7(b9)', 'C#dim7', 'Bbadd9', 'D5', '(Em)', 'Hm', 'N.C.'].map((c) => formatChord(c, ctx));
    expect(out).toEqual(['C', 'D', 'G', 'Am', 'F#m', 'E', 'C#dim', 'Bb', 'D', '(Em)', 'Bm', 'N.C.']);
    // Med transponering och svensk notation
    expect(formatChord('Gmaj7/F#', { transpose: 2, notation: 'swedish', simplify: true })).toBe('A');
    expect(formatChord('Gmaj7/F#', { transpose: 0, notation: 'international' })).toBe('Gmaj7/F#');
  });

  it('känner igen ackord men inte vanliga ord', () => {
    for (const c of ['C', 'Am', 'F#m7', 'Bb', 'Dsus4', 'G/B', 'Cmaj7', 'E7(b9)', 'Asus2', 'C#dim7', 'H7', 'D6/9', 'Gadd9', '(Em)']) {
      expect(isChord(c), c).toBe(true);
    }
    for (const w of ['Hej', 'Den', 'Bad', 'Aj', 'Add', 'Ge', 'Bo', 'Allt', 'Ett', 'Hon', 'Bara', 'Dag']) {
      expect(isChord(w), w).toBe(false);
    }
  });

  it('tolkar delar', () => {
    const c = parseChord('F#m7/C#')!;
    expect(c.root).toBe(6);
    expect(c.suffix).toBe('m7');
    expect(c.bass).toBe(1);
  });

  it('transponerar', () => {
    const ctx = { transpose: 2, notation: 'international' as const };
    expect(formatChord('G', ctx)).toBe('A');
    expect(formatChord('Em7', ctx)).toBe('F#m7');
    expect(formatChord('C/E', ctx)).toBe('D/F#');
    expect(formatChord('A', { ...ctx, transpose: 1, preferFlats: true })).toBe('Bb');
    expect(formatChord('*Paus', ctx)).toBe('Paus');
  });

  it('hanterar svensk notation', () => {
    expect(formatChord('B', { transpose: 0, notation: 'swedish' })).toBe('H');
    expect(formatChord('Bb', { transpose: 0, notation: 'swedish' })).toBe('B');
    // Källa i H-notation: B betyder Bb
    expect(formatChord('B', { transpose: 0, notation: 'international', hNotation: true })).toBe('Bb');
    expect(formatChord('H7', { transpose: 0, notation: 'international', hNotation: true })).toBe('B7');
  });

  it('tonart', () => {
    expect(formatKey(parseKey('G')!, 2, 'international')).toBe('A');
    expect(formatKey(parseKey('Dm')!, 3, 'international')).toBe('Fm');
    expect(formatKey(parseKey('C')!, 5, 'international')).toBe('F');
    expect(formatKey(parseKey('C')!, 3, 'international')).toBe('Eb');
  });
});

describe('ChordPro', () => {
  it('låtens längd från {duration}', () => {
    expect(parseDuration('3:30')).toBe(210);
    expect(parseDuration(' 210 ')).toBe(210);
    expect(parseDuration('1:02:03')).toBe(3723);
    expect(parseDuration('0:00')).toBeUndefined();
    expect(parseDuration('ca 3 min')).toBeUndefined();
    expect(parseDuration(undefined)).toBeUndefined();
    expect(parseChordPro('{duration: 4:05}\nText').meta.duration).toBe('4:05');
    expect(formatDuration(245)).toBe('4:05');
  });

  const src = `{title: Morgonvisa}
{artist: Test}
{key: G}
{capo: 2}

{start_of_verse: Vers 1}
[G]Solen går [C]upp över [D]ån
[G]vi går ut på [Em]stigen
{end_of_verse}

{soc}
[C]Sjung nu [G]med
{eoc}

{chorus}
`;
  it('tolkar metadata och sektioner', () => {
    const p = parseChordPro(src);
    expect(p.meta.title).toBe('Morgonvisa');
    expect(p.meta.capo).toBe('2');
    expect(p.sections.map((s) => s.type)).toEqual(['verse', 'chorus', 'chorus']);
    expect(p.sections[0].label).toBe('Vers 1');
    expect(p.sections[2].isRepeat).toBe(true);
    expect(p.sections[2].lines.length).toBe(1);
    expect(p.chords).toEqual(['G', 'C', 'D', 'Em']);
    const line = p.sections[0].lines[0];
    expect(line.type === 'lyrics' && line.segments[1]).toEqual({ chord: 'C', text: 'upp över ' });
  });

  it('uppdaterar direktiv', () => {
    let s = upsertDirective(src, 'title', 'Ny titel');
    expect(parseChordPro(s).meta.title).toBe('Ny titel');
    s = upsertDirective(s, 'tempo', '96');
    expect(s.split('\n').slice(0, 5)).toContain('{tempo: 96}');
    s = upsertDirective(s, 'capo', '');
    expect(parseChordPro(s).meta.capo).toBeUndefined();
  });

  it('transponerar källtext', () => {
    const out = transposeSource(src, { transpose: 2, notation: 'international' });
    expect(out).toContain('{key: A}');
    expect(out).toContain('[A]Solen går [D]upp över [E]ån');
  });
});

describe('textimport', () => {
  it('klassificerar rader', () => {
    expect(isChordLine(['G', 'C', 'D'])).toBe(true);
    expect(isChordLine(['G', '|', 'C', 'x2'])).toBe(true);
    expect(isChordLine(['Solen', 'går', 'upp'])).toBe(false);
    expect(parseHeader('Refräng:')?.kind).toBe('chorus');
    expect(parseHeader('Vers 2')?.label).toBe('Vers 2');
    expect(parseHeader('[Chorus]')?.kind).toBe('chorus');
    expect(parseHeader('Intro: G C D')?.trailing).toBe('G C D');
    expect(parseHeader('Vers som inte är rubrik')).toBeNull();
  });

  it('konverterar ackord ovanför text (monospace)', () => {
    const text = `Morgonvisa
Test

Vers 1:
G             C
Solen går upp över ån
D           G
vi går ut på stigen

Refräng:
C        G
Sjung nu med
`;
    const out = textToChordPro(text);
    expect(out).toContain('{title: Morgonvisa}');
    expect(out).toContain('{artist: Test}');
    expect(out).toContain('{start_of_verse: Vers 1}');
    expect(out).toContain('[G]Solen går upp [C]över ån');
    expect(out).toContain('[D]vi går ut på [G]stigen');
    expect(out).toContain('{start_of_chorus: Refräng}');
    expect(out).toContain('[C]Sjung nu [G]med');
    expect(looksLikeChordPro(out)).toBe(true);
    expect(looksLikeChordPro(text)).toBe(false);
  });

  it('placerar ackord efter visuell position med proportionellt typsnitt', () => {
    // Låtsastypsnitt: mellanslag är smala (0.3), bokstäver är 1 breda
    const measure: Measure = (t) => [...t].reduce((w, ch) => w + (ch === ' ' ? 0.3 : 1), 0);
    // "över" börjar på x = 5 + 0.3 + 3 + 0.3 + 3 + 0.3 = 11.9 i textraden.
    // I ackordraden: G (1) + 36 mellanslag (10.8) => C på x = 11.8, alltså över "ö".
    const chordLine = 'G' + ' '.repeat(36) + 'C';
    const out = textToChordPro(`${chordLine}
Solen går upp över ån
`, { measure });
    expect(out.trim()).toBe('[G]Solen går upp [C]över ån');
    // Samma rad tolkad som monospace hamnar långt efter radslut
    expect(textToChordPro(`${chordLine}
Solen går upp över ån
`).trim()).toMatch(/ån\s+\[C\]$/);
  });

  it('lägger ackord efter radslut', () => {
    const out = textToChordPro('G         D\nHej\n');
    expect(out.trim()).toBe('[G]Hej       [D]');
  });
});

describe('OCR-layout', () => {
  it('slår ihop ackordrader med textrader via x-position', () => {
    const W = 1000;
    const H = 1000;
    const word = (text: string, x: number, y: number, w: number) => ({ text, x: x / W, y: y / H, w: w / W, h: 20 / H });
    const page: OcrPage = {
      width: W,
      height: H,
      lines: [
        { text: 'G', x: 0, y: 0, w: 0, h: 0, words: [word('G', 100, 100, 15)] },
        // Ackordet C hamnar som egen OCR-rad på samma höjd
        { text: 'C', x: 0, y: 0, w: 0, h: 0, words: [word('C', 260, 102, 15)] },
        {
          text: 'Solen går upp över ån',
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          words: [word('Solen', 100, 125, 60), word('går', 170, 125, 35), word('upp', 215, 125, 40), word('över', 262, 125, 48), word('ån', 320, 125, 25)],
        },
      ],
    };
    const out = ocrToChordPro([page]);
    expect(out.trim()).toBe('[G]Solen går upp [C]över ån');
  });

  it('flyttar rubriker i marginalen, rättar felästa ackord och slår ihop stavelser', () => {
    const W = 1000;
    const H = 1000;
    const word = (text: string, x: number, y: number, w: number, h = 20) => ({ text, x: x / W, y: y / H, w: w / W, h: h / H });
    const line = (...words: ReturnType<typeof word>[]) => ({ text: words.map((w) => w.text).join(' '), x: 0, y: 0, w: 0, h: 0, words });
    const page: OcrPage = {
      width: W,
      height: H,
      lines: [
        line(word('Gg', 260, 100, 15), word('Di', 300, 100, 15)),
        line(word('Vers', 20, 125, 40), word('1', 65, 125, 10), word('Mor', 200, 125, 35), word('-', 245, 125, 8, 4), word('gon', 260, 125, 35), word('dagg', 300, 125, 45)),
        line(word('G/F?', 200, 150, 40)),
        line(word('Fåg', 200, 175, 35), word('lar', 240, 175, 30), word('sjunger', 280, 175, 70)),
      ],
    };
    const out = ocrToChordPro([page]);
    expect(out).toContain('{start_of_verse: Vers 1}');
    expect(out).toContain('Mor[G]gon [D11]dagg');
    expect(out).toContain('[G/F#]Fåg lar sjunger');
  });
});

describe('ackordgrepp', () => {
  it('normaliserar suffix', () => {
    expect(normalizeSuffix('')).toBe('major');
    expect(normalizeSuffix('m')).toBe('minor');
    expect(normalizeSuffix('M7')).toBe('maj7');
    expect(normalizeSuffix('sus')).toBe('sus4');
    expect(normalizeSuffix('7(b9)')).toBe('7b9');
  });
  it('räknar ut pianotoner', () => {
    expect(getPianoChord('Am')!.notes).toEqual([9, 12, 16]);
    expect(getPianoChord('C/E')!.bass).toBe(4);
  });
});

describe('synk', () => {
  it('senast ändrad vinner', () => {
    const local = [
      { id: 'a', createdAt: 0, updatedAt: 10 },
      { id: 'b', createdAt: 0, updatedAt: 10 },
    ];
    const remote = [
      { id: 'a', createdAt: 0, updatedAt: 5 },
      { id: 'b', createdAt: 0, updatedAt: 20, deletedAt: 20 },
      { id: 'c', createdAt: 0, updatedAt: 1 },
    ];
    expect(mergeRecords(local, remote).incoming.map((r) => r.id)).toEqual(['b', 'c']);
  });
  it('återställning återskapar raderade poster', () => {
    const local = [{ id: 'a', createdAt: 0, updatedAt: 50, deletedAt: 50 }];
    const backup = [{ id: 'a', createdAt: 0, updatedAt: 10 }];
    const out = restoreMerge(local, backup, 100);
    expect(out).toEqual([{ id: 'a', createdAt: 0, updatedAt: 100, deletedAt: undefined }]);
  });
});

describe('anteckningar', () => {
  const m20 = { tops: [0, 40, 70, 100], fontPx: 20 };
  const m30 = { tops: [0, 60, 105, 150], fontPx: 30 };

  it('fäster en punkt vid raden ovanför och mäter i em', () => {
    const a = anchorAt(m20, 50, 80);
    expect(a).toEqual({ line: 2, dx: 2.5, dy: 0.5 });
    expect(anchorToPx(m20, a)).toEqual({ x: 50, y: 80 });
  });

  it('följer med texten när textstorleken ändras', () => {
    const a = anchorAt(m20, 50, 80);
    // Samma rad, 1,5 gånger större text
    expect(anchorToPx(m30, a)).toEqual({ x: 75, y: 120 });
  });

  it('i två spalter: fäster vid raden i spalten och följer med till en spalt', () => {
    // Rad 0–2 i vänster spalt, rad 3–4 i höger (som börjar 500 px in)
    const two = { tops: [0, 40, 70, 0, 30], lefts: [0, 0, 0, 500, 500], fontPx: 20 };
    const right = anchorAt(two, 540, 35);
    expect(right).toEqual({ line: 4, dx: 2, dy: 0.25 });
    expect(anchorToPx(two, right)).toEqual({ x: 540, y: 35 });
    // Ovanför första raden i höger spalt: den raden
    expect(anchorAt(two, 520, -5).line).toBe(3);
    expect(anchorAt(two, 50, 80).line).toBe(2);
    // Samma ankare i en spalt: samma avstånd från raden
    const one = { tops: [0, 40, 70, 100, 130], fontPx: 20 };
    expect(anchorToPx(one, right)).toEqual({ x: 40, y: 135 });
  });

  it('skapar streck och hittar dem med suddet', () => {
    const s = strokeFromPx(m20, [10, 45, 50, 45, 90, 45], 'red', 0.1, 's1');
    expect(s.anchor.line).toBe(1);
    const px = strokeToPx(m20, s);
    expect(px).toEqual([10, 45, 50, 45, 90, 45]);
    expect(hitStroke(px, 70, 48, 5)).toBe(true);
    expect(hitStroke(px, 70, 60, 5)).toBe(false);
  });
});

describe('export av setlista', () => {
  const now = 1;
  const mk = (id: string, content: string, transpose = 0) => ({
    id,
    createdAt: now,
    updatedAt: now,
    title: id,
    artist: 'Test',
    content,
    tags: [],
    transpose,
  });
  const songs = {
    a: mk('a', '{title: Första}\n{key: G}\n\n{start_of_verse: Vers 1}\n[G]Solen går [C]upp\n{end_of_verse}\n'),
    b: mk('b', '{title: Andra}\n\n[D]Kvällen [A]kommer\n', 2),
  };
  const setlist = {
    id: 's',
    createdAt: now,
    updatedAt: now,
    name: 'Spelning',
    items: [
      { id: '1', songId: 'a' },
      { id: '2', songId: 'b' },
    ],
  };

  it('ren text utan ackord', () => {
    const t = buildTextExport(setlist, songs, 'international');
    expect(t).toContain('1. a – Test');
    expect(t).toContain('VERS 1');
    expect(t).toContain('Solen går upp');
    expect(t).not.toContain('[G]');
  });

  it('mejl: ämne och setlistan med titel och artist', () => {
    expect(mailSubject({ ...setlist, date: '2026-10-24' })).toBe('Spelning');
    const body = mailBody(setlist, songs, 'international');
    expect(body.split('\n').slice(0, 4)).toEqual(['Spelning', '', '1. a – Test', '2. b – Test']);
  });

  it('en fil per låt, numrerade i setlistans ordning', async () => {
    const files = await buildSongFiles('chordpro', setlist, songs, 'international');
    expect(files.map((f) => f.name)).toEqual(['01 a.txt', '02 b.txt']);
    expect(await files[1].blob.text()).toContain('[E]Kvällen [B]kommer');
    const texts = await buildSongFiles('text', setlist, songs, 'international');
    expect(await texts[0].blob.text()).toContain('Solen går upp');
  });

  it('kontrollerar e-postadresser', () => {
    expect(isValidEmail('namn@exempel.se')).toBe(true);
    expect(isValidEmail('namn@exempel')).toBe(false);
    expect(isValidEmail('namn exempel.se')).toBe(false);
  });

  it('ChordPro med transponering och new_song', () => {
    const t = buildChordProExport(setlist, songs, 'international');
    expect(t).toContain('# Setlista: Spelning');
    expect(t).toContain('{new_song}');
    expect(t).toContain('[G]Solen går [C]upp');
    expect(t).toContain('[E]Kvällen [B]kommer');
  });
});

describe('rubrikrader i ChordPro', () => {
  const src = `{title: Kortform}

Intro: G C D

Vers 1:
[G]Morgonen är [C]stilla
[D]fåglarna har vaknat

Refräng:
[C]Sjung med [G]oss
[D]hela dagen

Vers 2
[G]Kvällen kommer [C]sakta

Refräng
`;
  const p = parseChordPro(src);

  it('tolkar Vers 1: och Refräng: som sektioner', () => {
    const secs = p.sections.filter((s) => s.type !== 'none');
    expect(secs.map((s) => [s.type, s.label, s.isRepeat ?? false])).toEqual([
      ['verse', 'Vers 1', false],
      ['chorus', 'Refräng', false],
      ['verse', 'Vers 2', false],
      ['chorus', 'Refräng', true],
    ]);
    expect(secs[0].lines.length).toBe(2);
    // Upprepningen visar refrängens rader
    expect(secs[3].lines.length).toBe(2);
  });

  it('Intro: med ackord blir kommentar och ackordrad', () => {
    const intro = p.sections.find((s) => s.lines.some((l) => l.type === 'comment'))!;
    expect(intro.lines[0]).toEqual({ type: 'comment', text: 'Intro', style: 'normal' });
    expect(p.chords.slice(0, 3)).toEqual(['G', 'C', 'D']);
  });

  it('transponerar ackord efter en rubrik', () => {
    const out = transposeSource('Intro: G C D\n', { transpose: 2, notation: 'international' });
    expect(out.trim()).toBe('Intro: A D E');
  });

  it('vanliga textrader påverkas inte', () => {
    const q = parseChordPro('Slut på dagen\nSolo i natt\n');
    expect(q.sections[0].lines.every((l) => l.type === 'lyrics')).toBe(true);
  });
});

describe('tonartsfilter', () => {
  const mk = (id: string, content: string, transpose = 0) => ({
    id,
    createdAt: 1,
    updatedAt: 1,
    title: id,
    artist: '',
    content,
    tags: [],
    transpose,
  });
  const songs = [
    mk('g', '{key: G}\n[G]Ett [C]två\n'),
    mk('f-till-g', '{key: F}\n[F]Tre [Bb]fyra\n', 2),
    mk('am', '[Am]Fem [Dm]sex\n'),
    mk('db', '{key: Db}\n[Db]Sju\n'),
    mk('ciss', '{key: C#}\n[C#]Åtta\n'),
    mk('ingen', 'Bara text utan ackord\n'),
  ];

  it('räknar in transponering och gissar från första ackordet', () => {
    expect(keyId(songKey(songs[1])!.key)).toBe('7');
    const am = songKey(songs[2])!;
    expect(keyId(am.key)).toBe('9m');
    expect(am.guessed).toBe(true);
    expect(songKey(songs[5])).toBeNull();
  });

  it('tonart med setlistans egen transponering', () => {
    const s = songs[1];
    expect(keyId(songKey(s, s.transpose + 2)!.key)).toBe('9');
    // Låtens egen gäller fortfarande utan argument (och cachen blandar inte ihop dem)
    expect(keyId(songKey(s)!.key)).toBe('7');
    expect(itemTranspose({ id: 'a', songId: s.id, transpose: -1 }, s)).toBe(-1);
    expect(itemTranspose({ id: 'a', songId: s.id, transpose: 0 }, s)).toBe(0);
    expect(itemTranspose({ id: 'a', songId: s.id }, s)).toBe(s.transpose);
    expect(itemTranspose(undefined, s)).toBe(s.transpose);
  });

  it('listar tonarter i tonskalans ordning, C# och Db som samma', () => {
    expect(keysInLibrary(songs)).toEqual(['1', '7', '9m']);
    expect(keyIdLabel('1', 'international')).toBe('Db');
    expect(keyIdLabel('9m', 'international')).toBe('Am');
  });

  it('filtrerar fram låtar i samma tonart', () => {
    expect(filterSongs(songs, { query: '', fullText: false, tags: [], keyId: '7' }).map((s) => s.id)).toEqual(['g', 'f-till-g']);
    expect(filterSongs(songs, { query: '', fullText: false, tags: [], keyId: '1' }).map((s) => s.id)).toEqual(['db', 'ciss']);
  });
});

describe('ackordrader med taktsymboler', () => {
  it('känner igen rader med bara ackord och symboler', () => {
    const row = parseLyricsLine('[C] / / [G/B] / / | [Am] / / [G] [Am] [G/B]');
    expect(isChordRow(row)).toBe(true);
    expect(isChordRow(parseLyricsLine('[C] / / | x2'))).toBe(true);
    expect(isChordRow(parseLyricsLine('[C]Solen går [G]upp'))).toBe(false);
    expect(isChordRow(parseLyricsLine('Bara text'))).toBe(false);
  });

  it('textimporten gör om en ackordrad med snedstreck till ChordPro', () => {
    const out = textToChordPro('C / / G/B / / | Am / / G Am G/B\n');
    expect(out.trim()).toBe('[C] / / [G/B] / / | [Am] / / [G] [Am] [G/B]');
  });
});

describe('igenkänning av ChordPro', () => {
  it('filändelsen avgör', () => {
    for (const n of ['Låt.cho', 'låt.CHOPRO', 'a.chordpro', 'b.crd', 'c.pro']) expect(isChordProFileName(n), n).toBe(true);
    for (const n of ['låt.txt', 'låt.text', 'professor.txt']) expect(isChordProFileName(n), n).toBe(false);
  });

  it('känner igen innehåll med valfritt direktiv eller ett ackord i texten', () => {
    expect(looksLikeChordPro('{t: Kort titel}\nEn rad text\n')).toBe(true);
    expect(looksLikeChordPro('{key: G}\nEn rad text\n')).toBe(true);
    expect(looksLikeChordPro('En rad med [G]ackord i\n')).toBe(true);
    expect(looksLikeChordPro('[C] / / [G] / /\n')).toBe(true);
    expect(looksLikeChordPro('G        C\nVanlig text under ackord\n')).toBe(false);
    expect(looksLikeChordPro('[Verse 1]\nVanlig text\n')).toBe(false);
  });
});

describe('ackord mellan ord', () => {
  it('flyttar ett ackord från mellanslaget till nästa ord', () => {
    const segs = splitWords(parseLyricsLine('Ett [E]två, tre [E/G#]fem,[A/C#] sex sju'));
    expect(segs.map((s) => [s.chord ?? '', s.text])).toEqual([
      ['', 'Ett '],
      ['E', 'två, '],
      ['', 'tre '],
      ['E/G#', 'fem, '],
      ['A/C#', 'sex '],
      ['', 'sju'],
    ]);
  });

  it('behåller ackord i direkt följd som egna kolumner', () => {
    const segs = splitWords(parseLyricsLine('elva[A] [A/C#]tolv'));
    expect(segs.map((s) => [s.chord ?? '', s.text])).toEqual([
      ['', 'elva'],
      ['A', ' '],
      ['A/C#', 'tolv'],
    ]);
  });

  it('ackord först på raden före ett mellanslag', () => {
    const segs = splitWords(parseLyricsLine('[A] Och var'));
    expect(segs.map((s) => [s.chord ?? '', s.text])).toEqual([
      ['', ' '],
      ['A', 'Och '],
      ['', 'var'],
    ]);
  });
});

describe('teckenkodning', () => {
  const sample = '{title: Kodtest}\r\n[G]Åsa går [C]över ån\r\n';
  const utf16le = (s: string, bom: boolean) => {
    const out: number[] = bom ? [0xff, 0xfe] : [];
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      out.push(c & 0xff, c >> 8);
    }
    return new Uint8Array(out).buffer;
  };

  it('läser UTF-16 med och utan BOM', () => {
    for (const bom of [true, false]) {
      const text = decodeText(utf16le(sample, bom));
      expect(text).toBe(sample);
      expect(text.includes('\u0000')).toBe(false);
    }
  });

  it('läser UTF-8 och Windows-1252', () => {
    expect(decodeText(new TextEncoder().encode(sample).buffer)).toBe(sample);
    const latin1 = new Uint8Array([...'G'].map((c) => c.charCodeAt(0)).concat([0xc5, 0x73, 0x61])).buffer; // "GÅsa"
    expect(decodeText(latin1)).toBe('GÅsa');
  });
});

describe('rader inom parentes', () => {
  it('en hel rad inom parentes blir en kommentar', () => {
    const p = parseChordPro('Vers 1:\n[G]Ett [C]test\n(Upprepa refrängen)\n  (x2)  \n');
    const lines = p.sections[0].lines;
    expect(lines[1]).toEqual({ type: 'comment', text: 'Upprepa refrängen', style: 'normal' });
    expect(lines[2]).toEqual({ type: 'comment', text: 'x2', style: 'normal' });
  });

  it('parenteser inne i en rad eller med ackord påverkas inte', () => {
    const p = parseChordPro('Det här (inom parentes) är text\n([G]la la)\n');
    expect(p.sections[0].lines.every((l) => l.type === 'lyrics')).toBe(true);
  });
});

describe('delrubriker A:, B:', () => {
  it('tolkar A:, B2: och Del C: som delar', () => {
    const p = parseChordPro('A:\n[G]Ett [C]test\n\nB2:\n[D]Ett till\n\nDel C:\n[E]Sista\n');
    const secs = p.sections.filter((s) => s.type !== 'none');
    expect(secs.map((s) => [s.type, s.label, s.lines.length])).toEqual([
      ['other', 'A', 1],
      ['other', 'B2', 1],
      ['other', 'Del C', 1],
    ]);
  });

  it('ett ensamt A utan kolon är fortfarande ett ackord', () => {
    const p = parseChordPro('[A]\n');
    expect(p.chords).toEqual(['A']);
    expect(parseHeader('A')).toBeNull();
  });

  it('textimporten gör om A: till en del', () => {
    const out = textToChordPro('A:\nG        C\nHär är en rad\n');
    expect(out).toContain('{start_of_part: A}');
    expect(out).toContain('{end_of_part}');
  });
});

describe('ord som delas av ackord', () => {
  it('markerar bitar där ordet fortsätter i nästa bit', () => {
    const segs = splitWords([{ text: 'Sol' }, { chord: 'C', text: 'ros i ' }, { chord: 'G', text: 'Mor-' }, { chord: 'D', text: 'gon' }]);
    expect(midWordBreaks(segs)).toEqual([true, false, false, false, false]);
  });
});

describe('filnamn i zip-filer', () => {
  it('tolkar namn utan UTF-8-markering', () => {
    expect(decodeZipName(new TextEncoder().encode('Sång om älven.pdf'), false)).toBe('Sång om älven.pdf');
    // Teckentabell 437: å = 0x86, ä = 0x84, ö = 0x94
    expect(decodeZipName(new Uint8Array([0x86, 0x84, 0x94, 0x2e, 0x70, 0x6e, 0x67]), false)).toBe('åäö.png');
    expect(decodeZipName(new Uint8Array([0xff]), false)).toBe(' ');
  });
  it('ger rätt namn även när zip-filen saknar UTF-8-markering', () => {
    const zip = zipSync({ 'Höstvisa.pdf': new Uint8Array([1, 2, 3]) });
    // Ta bort UTF-8-markeringen (bit 11) i alla filhuvuden, som t.ex. Arkivverktyget på Mac gör
    const view = new DataView(zip.buffer);
    for (let i = 0; i + 4 <= zip.length; i++) {
      const sig = view.getUint32(i, true);
      if (sig === 0x04034b50) view.setUint16(i + 6, view.getUint16(i + 6, true) & ~0x800, true);
      if (sig === 0x02014b50) view.setUint16(i + 8, view.getUint16(i + 8, true) & ~0x800, true);
    }
    const key = Object.keys(unzipSync(zip))[0];
    expect(key).not.toBe('Höstvisa.pdf');
    expect(zipNameMap(zip).get(key)).toBe('Höstvisa.pdf');
  });
  it('gör om "a" + ring till "å" i titlar från filnamn', () => {
    expect(titleFromFileName('Sång.pdf')).toBe('Sång');
  });
});

describe('mellanpunkter i setlistor', () => {
  const song = (id: string, title: string): Song => ({ id, title, artist: '', content: '', tags: [], transpose: 0, createdAt: 1, updatedAt: 1 });
  const songs = { a: song('a', 'Första'), b: song('b', 'Andra') };
  const setlist: Setlist = {
    id: 's',
    name: 'Kväll',
    createdAt: 1,
    updatedAt: 1,
    items: [
      { id: '1', songId: 'a' },
      { id: '2', songId: '', cue: 'Tal' },
      { id: '3', songId: 'b' },
    ],
  };
  it('visas i bläddringen och i översikten men räknas inte som låtar', () => {
    const items = liveItems(setlist.items, songs);
    expect(items.map((it) => itemTitle(it, songs))).toEqual(['Första', 'Tal', 'Andra']);
    expect(songCount(items)).toBe(2);
    expect(itemPath('s', items[1], 1)).toBe(`/song/${CUE_ROUTE_ID}?setlist=s&i=1`);
    const text = buildTextExport(setlist, songs, 'international');
    expect(text).toContain('1. Första\n   – Tal –\n2. Andra');
  });
});

describe('kapo', () => {
  it('visar greppen: ackorden flyttas ner så många halvtoner som kapot sitter', () => {
    const song = parseChordPro('{key: A}\n{capo: 2}\n[A]Ett [D]två [E7]tre [F#m]fyra');
    expect(capoOf(song)).toBe(2);
    const ctx = displayChordContext(song, 0, 'international');
    expect(song.chords.map((c) => formatChord(c, ctx))).toEqual(['G', 'C', 'D7', 'Em']);
    // Transponering räknas på det som klingar, kapot dras av för greppen
    const up = displayChordContext(song, 2, 'international');
    expect(formatChord('A', up)).toBe('A');
  });
  it('lämnar ackorden som de är utan kapo', () => {
    const song = parseChordPro('[Bb]Ett');
    expect(formatChord('Bb', displayChordContext(song, 0, 'international'))).toBe('Bb');
  });
});

describe('ackord skrivna som grepp för kapo', () => {
  const src = '{title: Test}\n{key: B}\n{capo: 4}\n[G]Ett [D]två [G]tre\nfyra [C]fem [D]sex [G]sju';
  it('upptäcks när ackorden passar tonarten minus kapot', () => {
    expect(capoShapeShift(parseChordPro(src))).toBe(4);
    expect(capoShapeShift(parseChordPro('{key: G}\n{capo: 4}\n[G]Ett [D]två [C]tre'))).toBe(0);
    expect(capoShapeShift(parseChordPro('{key: B}\n[G]Ett [D]två [C]tre'))).toBe(0);
  });
  it('misstar inte vanliga låtar med kapo för grepp', () => {
    const shift = (src: string) => capoShapeShift(parseChordPro(src));
    // bVII-ackord (C i D-dur, F i G-dur) är vanliga och betyder inte att ackorden är grepp
    expect(shift('{key: D}\n{capo: 2}\n[D]Ett [C]två [G]tre [D]fyra')).toBe(0);
    expect(shift('{key: G}\n{capo: 2}\n[G]Ett [F]två [C]tre [G]fyra')).toBe(0);
    expect(shift('{key: G}\n{capo: 7}\n[G]Ett [F]två [C]tre [D]fyra')).toBe(0);
    // För få ackord för att avgöra
    expect(shift('{key: D}\n{capo: 2}\n[D]Ett [C]två')).toBe(0);
    // Moll
    expect(shift('{key: Am}\n{capo: 2}\n[Am]Ett [G]två [F]tre [E]fyra')).toBe(0);
    // Tydliga grepp: G-ackord med tonart A och kapo 2
    expect(shift('{key: A}\n{capo: 2}\n[G]Ett [C]två [D]tre [Em]fyra')).toBe(2);
  });
  it('skrivs om till tonarten och visar samma grepp som förut', () => {
    const out = shapesToSounding(src);
    expect(out).toContain('{key: B}');
    expect(out).toContain('{capo: 4}');
    expect(out).toContain('[B]Ett [F#]två [B]tre');
    const parsed = parseChordPro(out);
    const ctx = displayChordContext(parsed, 0, 'international');
    expect(parsed.chords.map((c) => formatChord(c, ctx))).toEqual(['G', 'D', 'C']);
  });
});

describe('alternativ titel', () => {
  it('tolkar {subtitle} som alternativ titel, inte som artist', () => {
    const meta = deriveSongMeta('{title: Vintervisa}\n{subtitle: Snön faller}\n');
    expect(meta.subtitle).toBe('Snön faller');
    expect(meta.artist).toBe('');
  });
  it('går att söka på', () => {
    const s = { id: 'x', title: 'Vintervisa', subtitle: 'Snön faller', artist: '', content: '', tags: [], transpose: 0, createdAt: 1, updatedAt: 1 };
    expect(filterSongs([s], { query: 'snön', fullText: false, tags: [] })).toHaveLength(1);
  });
});

describe('låtar som filer', () => {
  const song = (id: string, title: string, artist = '', attachment?: Song['attachment']): Song => ({
    id, title, artist, content: `{title: ${title}}`, tags: [], transpose: 0, createdAt: 1, updatedAt: 1, attachment,
  });
  it('ger unika och säkra filnamn', () => {
    const names = songFileNames([
      song('1', 'Höstvisa', 'Kören'),
      song('2', 'Höstvisa', 'Kören'),
      song('3', 'Ja/nej?'),
      song('4', 'Noter', '', { name: 'noter.PDF', mime: 'application/pdf', dataUrl: 'data:,', kind: 'pdf' }),
    ]).map((f) => f.name);
    expect(names).toEqual(['Höstvisa – Kören.cho', 'Höstvisa – Kören (2).cho', 'Ja-nej-.cho', 'Noter.pdf']);
  });
});

describe('originalfiler i säkerhetskopior', () => {
  const backup = (attachment: Song['attachment']): BackupFile => ({
    format: 'songlist-backup',
    version: 1,
    createdAt: 1,
    deviceId: 'd',
    songs: [{ id: 's', title: 'Noter', artist: '', content: '{title: Noter}', tags: [], transpose: 0, createdAt: 1, updatedAt: 1, attachment }],
    setlists: [],
    categories: [],
    folders: [],
  });
  it('ger samma namn för samma innehåll', async () => {
    const a = { name: 'Noter.PDF', mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,QUJD', kind: 'pdf' as const };
    const b64 = dataUrlBase64(a.dataUrl)!;
    expect(b64).toBe('QUJD');
    const h1 = await contentHash(b64);
    expect(await contentHash('QUJD')).toBe(h1);
    expect(await contentHash('QUJE')).not.toBe(h1);
    expect(attachmentFileName(h1, a)).toBe(`${h1}.pdf`);
    expect(referencedFiles(backup({ ...a, dataUrl: '', file: 'x.pdf' }))).toEqual(['x.pdf']);
  });
  it('behåller låten med en anteckning när filen saknas', () => {
    const out = markMissingAttachments(backup({ name: 'Noter.pdf', mime: 'application/pdf', dataUrl: '', kind: 'pdf', file: 'x.pdf' }));
    expect(out.songs[0].attachment).toBeUndefined();
    expect(out.songs[0].content).toContain('Originalfilen Noter.pdf saknas');
  });
});

describe('ändringar i setlistor', () => {
  it('behåller punkter som inte visas när en synlig punkt flyttas', () => {
    const all = [{ id: '1', songId: 'a' }, { id: '2', songId: 'raderad' }, { id: '3', songId: 'b' }, { id: '4', songId: 'c' }];
    const visible = [all[0], all[2], all[3]];
    // Flytta c först
    expect(moveVisible(all, visible, 2, 0).map((it) => it.id)).toEqual(['4', '2', '1', '3']);
    expect(moveVisible(all, visible, 0, 2).map((it) => it.id)).toEqual(['3', '2', '4', '1']);
  });
});

describe('ackordgrepp med svensk notation', () => {
  it('tolkar B som Bb och H som B', async () => {
    expect(getPianoChord('B', true)!.notes).toEqual(getPianoChord('Bb')!.notes);
    expect(getPianoChord('H', true)!.notes).toEqual(getPianoChord('B')!.notes);
    expect(getPianoChord('Bm', true)!.notes).toEqual(getPianoChord('Bbm')!.notes);
  });
});

describe('bokstavsgrupper i låtlistan', () => {
  it('följer den svenska sorteringen', () => {
    expect(['Émile', 'Über', 'Æble', 'Øresund', 'Åska', '2 små fåglar', '"Citat"'].map(groupLetter)).toEqual(['E', 'Y', 'Ä', 'Ö', 'Å', '#', '#']);
    expect(groupLetter('Åska')).toBe('Å'); // å som a + ring
  });
  it('ger sammanhängande grupper efter sortering', () => {
    const titles = ['Zorro', 'Über', 'Ett', 'Émile', 'Abba', 'Öde', 'Ørn', 'Yxa', '9 liv', 'Ärlig', 'Åsa'];
    const songs = titles.map((title, i) => ({ id: String(i), title, artist: '', content: '', tags: [], transpose: 0, createdAt: 1, updatedAt: 1 }));
    const letters = sortSongs(songs, 'title').map((s) => groupLetter(s.title));
    const seen = new Set<string>();
    letters.forEach((l, i) => {
      if (i > 0 && letters[i - 1] !== l) expect(seen.has(l)).toBe(false);
      seen.add(l);
    });
  });
});

describe('exempellåten', () => {
  it('ersätts av en radering från en annan enhet', () => {
    const sample: Song = { id: 'songlist-exempel', title: 'Välkommen', artist: '', content: 'x', tags: [], transpose: 0, createdAt: 1, updatedAt: 1 };
    const tomb = { ...sample, content: '', deletedAt: 5000, updatedAt: 5000 };
    const { incoming } = mergeRecords([sample], [tomb]);
    expect(incoming).toHaveLength(1);
    expect(incoming[0].deletedAt).toBe(5000);
  });
});

describe('direktiv med {meta: …} och dubbletter', () => {
  it('ändrar titel och kapo även när de står som {meta: …}', () => {
    const out = upsertDirective('{meta: title Gammal}\n{meta: capo 2}\nText', 'title', 'Ny');
    expect(parseChordPro(out).meta.title).toBe('Ny');
    const capo = upsertDirective(out, 'capo', '3');
    expect(capoOf(parseChordPro(capo))).toBe(3);
    expect(capo).not.toContain('meta: capo');
  });
  it('tar bort dubbletter så att det nya värdet gäller', () => {
    const src = '{title: A}\n{title: B}\nText';
    expect(parseChordPro(upsertDirective(src, 'title', 'C')).meta.title).toBe('C');
    expect(parseChordPro(upsertDirective(src, 'title', '')).meta.title).toBeUndefined();
  });
  it('flyttar tonarten vid permanent transponering, även "A moll" och {meta: key}', () => {
    const ctx = { transpose: 2, preferFlats: false, notation: 'international' as const };
    expect(transposeSource('{key: A moll}\n[Am]Ett', ctx)).toContain('{key: Bm}');
    expect(transposeSource('{meta: key G}\n[G]Ett', ctx)).toContain('{meta: key A}');
    expect(transposeSource('{key: G}\n[G]Ett', ctx)).toContain('{key: A}');
  });
});

describe('å, ä och ö som bokstav + prick/ring', () => {
  it('görs om till vanliga tecken när filen läses', () => {
    const nfd = '{title: Sång}\nRefräng:\n[G]Hej'.normalize('NFD');
    const text = decodeText(new TextEncoder().encode(nfd).buffer);
    expect(text).toBe(text.normalize('NFC'));
    const song = parseChordPro(text);
    expect(song.meta.title).toBe('Sång');
    expect(song.sections.some((s) => s.type === 'chorus')).toBe(true);
  });
});

describe('direktiv överst i låten', () => {
  it('lämnar tonartsbyten längre ner i låten', () => {
    const src = '{title: Byte}\n{key: C}\n[C]Ett\n{key: D}\n[D]Två';
    const out = upsertDirective(src, 'key', 'G');
    expect(out).toContain('{key: G}');
    expect(out).toContain('{key: D}');
    // Utan tonart överst läggs den till överst; tonartsbytet står kvar
    const noHead = upsertDirective('{title: X}\n[C]Ett\n{key: D}\n[D]Två', 'key', 'C');
    expect(noHead.split('\n')[1]).toBe('{key: C}');
    expect(noHead).toContain('{key: D}');
  });
  it('lämnar flera {meta: artist …}', () => {
    const out = upsertDirective('{title: X}\n{meta: artist A}\n{meta: artist B}\nText', 'title', 'Y');
    expect(out).toContain('{meta: artist A}');
    expect(out).toContain('{meta: artist B}');
  });
  it('skriver om grepp med ett tonartsbyte utan att ta bort det', () => {
    const src = '{key: A}\n{capo: 2}\n[G]Ett [C]två [D]tre [Em]fyra\n{key: B}\n[A]Fem [D]sex';
    const out = shapesToSounding(src);
    expect(out.split('\n')[0]).toBe('{key: A}');
    expect(out).toContain('{key: B}');
    expect(out).toContain('[A]Ett [D]två');
  });
});

describe('grepp för kapo i andra tonarter', () => {
  const shift = (src: string) => capoShapeShift(parseChordPro(src));
  it('upptäcks även när greppens grundtoner finns i den riktiga tonarten', () => {
    expect(shift('{key: Bb}\n{capo: 3}\n[G]Ett [C]två [D]tre [Em]fyra')).toBe(3);
    expect(shift('{key: F}\n{capo: 1}\n[E]Ett [A]två [B]tre')).toBe(1);
    expect(shift('{key: Bb}\n{capo: 1}\n[A]Ett [D]två [E]tre')).toBe(1);
    expect(shift('{key: Am}\n{capo: 2}\n[Gm]Ett [Cm]två [Dm]tre')).toBe(2);
  });
  it('misstar fortfarande inte bVII för grepp', () => {
    expect(shift('{key: D}\n{capo: 2}\n[D]Ett [C]två [G]tre [D]fyra')).toBe(0);
    expect(shift('{key: G}\n{capo: 2}\n[G]Ett [F]två [C]tre [G]fyra [D]fem')).toBe(0);
    expect(shift('{key: A}\n{capo: 2}\n[A]Ett [D]två [E]tre [F#m]fyra [Bm]fem')).toBe(0);
  });
});

describe('text i PDF:en', () => {
  it('byter ut tecken som PDF-typsnittet saknar', () => {
    expect(pdfSafe('“Hej” – så — där…')).toBe('“Hej” – så — där…');
    expect(pdfSafe('Hej 🎸 nu')).toBe('Hej  nu');
    expect(pdfSafe('F♯ och B♭ − ő')).toBe('F# och Bb - o');
  });
  it('ger läsbar text i exporten även med emoji', async () => {
    const s: Song = { id: 's', title: 'Gitarr 🎸', artist: '', content: '{title: Gitarr 🎸}\n[G]Sjung 🎶 så glatt', tags: [], transpose: 0, createdAt: 1, updatedAt: 1 };
    const setlist: Setlist = { id: 'l', name: 'Lista', createdAt: 1, updatedAt: 1, items: [{ id: '1', songId: 's' }] };
    const blob = await buildPdfExport(setlist, { s }, 'international', false);
    const raw = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
    // Titeln ritas i ett stycke: med en emoji blev den två byte per tecken
    expect(raw).not.toMatch(/\u0000G\u0000i\u0000t/);
    expect(raw).toContain('Gitarr');
  });
});

describe('lappar inom låten', () => {
  it('hålls inom bredden och under överkanten', () => {
    expect(clampNoteCenter({ x: 900, y: 50 }, 100, 60, 400)).toEqual({ x: 350, y: 50 });
    expect(clampNoteCenter({ x: -20, y: -10 }, 100, 60, 400)).toEqual({ x: 50, y: 30 });
    expect(clampNoteCenter({ x: 200, y: 100 }, 100, 60, 400)).toEqual({ x: 200, y: 100 });
    // Bredare än låten: mitt i
    expect(clampNoteCenter({ x: 10, y: 100 }, 500, 60, 400).x).toBe(200);
  });
});

describe('långa namn i PDF:en', () => {
  it('kortar långa titlar på första sidan så att de inte går in i tonarten', async () => {
    const title = 'En väldigt lång titel som aldrig tar slut och fortsätter och fortsätter ännu längre bort';
    const s: Song = { id: 's', title, artist: 'Kören', content: `{title: ${title}}\n{key: G}\n[G]Hej`, tags: [], transpose: 0, createdAt: 1, updatedAt: 1 };
    const setlist: Setlist = { id: 'l', name: 'Lista', createdAt: 1, updatedAt: 1, items: [{ id: '1', songId: 's' }] };
    const raw = new TextDecoder('latin1').decode(new Uint8Array(await (await buildPdfExport(setlist, { s }, 'international', false)).arrayBuffer()));
    // Första sidan: kortad med …; låtens egen rubrik radbryts i stället
    expect(raw).toMatch(/\(En väldigt lång titel[^)]*…\) Tj/);
    expect(raw).toContain('längre bort) Tj');
  });
});

describe('småfel', () => {
  it('ß ger bokstaven S', () => {
    expect(groupLetter('ßtraße')).toBe('S');
  });
  it('en bifogad fil utan namn behålls', () => {
    const lib = sanitizeLibrary({
      songs: [{ id: 's', updatedAt: 1, attachment: { mime: 'application/pdf', dataUrl: '', file: 'x.pdf', kind: 'pdf' } } as unknown as Song],
      setlists: [],
      categories: [],
      folders: [],
    });
    expect(lib.songs[0].attachment?.file).toBe('x.pdf');
    expect(lib.songs[0].attachment?.name).toBe('fil');
  });
});
