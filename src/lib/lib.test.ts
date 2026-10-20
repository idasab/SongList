import { describe, expect, it } from 'vitest';
import { formatChord, isChord, parseChord, parseKey, formatKey } from './chords';
import { parseChordPro, transposeSource, upsertDirective } from './chordpro';
import { isChordLine, parseHeader } from './layout';
import { looksLikeChordPro, textToChordPro, type Measure } from './textImport';
import { ocrToChordPro, type OcrPage } from './ocrLayout';
import { getPianoChord, normalizeSuffix } from './chordShapes';
import { mergeRecords, restoreMerge } from './merge';
import { anchorAt, anchorToPx, hitStroke, strokeFromPx, strokeToPx } from './annotations';
import { buildChordProExport, buildSongFiles, buildTextExport, mailBody, mailSubject } from '../services/setlistExport';
import { isValidEmail } from '../services/mail';

describe('ackord', () => {
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
    expect(mailSubject({ ...setlist, date: '2026-10-24' })).toBe('Setlista: Spelning (24 oktober 2026)');
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
