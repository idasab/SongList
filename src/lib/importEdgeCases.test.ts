// Fall som inte ska tolkas fel vid import och visning (från en granskning av tolkningen).
import { describe, expect, it } from 'vitest';
import { parseChordPro } from './chordpro';
import { extractImportMeta } from './importMeta';
import { parseHeader } from './layout';
import { ocrToChordPro, type OcrPage } from './ocrLayout';

const W = 1000;
const H = 1000;
const word = (text: string, x: number, y: number, w: number, h = 25) => ({ text, x: x / W, y: y / H, w: w / W, h: h / H });
const line = (...words: ReturnType<typeof word>[]) => ({ text: words.map((w) => w.text).join(' '), x: 0, y: 0, w: 0, h: 0, words });
const page = (...lines: ReturnType<typeof line>[]): OcrPage => ({ width: W, height: H, lines });
const sections = (src: string) => parseChordPro(src).sections.map((s) => `${s.label ?? s.type}${s.isRepeat ? '*' : ''}:${s.lines.length}`);

describe('delar med rubrikrad', () => {
  it('bara refrängen har rubrik: stycket efter tomraden är en vers', () => {
    expect(sections('Refräng:\n[C]a\n[D]b\n\n[G]vers två\n\nRefräng')).toEqual(['Refräng:2', 'none:1', 'Refräng*:2']);
  });

  it('stycket efter refrängen följs av en upprepad refräng: det är en vers', () => {
    expect(sections('Vers 1:\n[G]a\n\nRefräng:\n[C]b\n[D]c\n\n[G]vers två\n\nRefräng')).toEqual([
      'Vers 1:1',
      'Refräng:2',
      'none:1',
      'Refräng*:2',
    ]);
  });

  it('"Refräng:" följd av tomrad och en ny rubrik upprepar refrängen', () => {
    expect(sections('Vers 1:\n[G]a\n\nRefräng:\n[C]x\n\nVers 2:\n[G]y\n\nRefräng:\n\nVers 3:\n[G]z\n\n{chorus}')).toEqual([
      'Vers 1:1',
      'Refräng:1',
      'Vers 2:1',
      'Refräng*:1',
      'Vers 3:1',
      'Refräng*:1',
    ]);
  });

  it('"Kör två" som sångtext är ingen rubrik, men "Intro two:" och "Last Outro:" är det', () => {
    expect(parseHeader('Kör två')).toBeNull();
    expect(parseHeader('Last chorus')).toBeNull();
    expect(parseHeader('Kör två:')?.label).toBe('Kör 2');
    const lines = parseChordPro('Intro two:\n[C] [G]\n\nLast Outro:\n[C]').sections.flatMap((s) => s.lines);
    expect(lines.filter((l) => l.type === 'comment').map((l) => (l.type === 'comment' ? l.text : ''))).toEqual(['Intro 2', 'Last outro']);
  });
});

describe('uppgifter i huvudet', () => {
  it('låt utan ackord: textrader som liknar titeln eller uppgifter blir kvar', () => {
    const src = '{title: Halleluja}\n\nSjung nu\nHalleluja\nVi går\nHalleluja\n    indragen rad\nJag skrev en text: om dig\nTime: is running out';
    const out = extractImportMeta(src);
    expect(out.split('\n').filter((l) => l.trim() === 'Halleluja')).toHaveLength(2);
    expect(out).toContain('    indragen rad');
    expect(out).toContain('Jag skrev en text: om dig');
    expect(out).toContain('Time: is running out');
    expect(out).not.toMatch(/\{(lyricist|time)/);
  });

  it('artist från andra raden som egentligen är en upphovsperson eller tonart', () => {
    expect(extractImportMeta('{title: Visa}\n{artist: Text: Anna Exempel}\n\n[C]la')).toContain('{lyricist: Anna Exempel}');
    expect(extractImportMeta('{title: Visa}\n{artist: Text & Music: Anna}\n\n[C]la')).toContain('{artist: Anna}');
    const key = extractImportMeta('{title: Visa}\n{artist: Key: G}\n\n[C]la');
    expect(key).toContain('{key: G}');
    expect(key).not.toContain('{artist');
  });

  it('tonart i moll, upphovsperson på titelraden och utskriftshuvud på varje sida', () => {
    expect(extractImportMeta('{title: Visa}\n\nKey: E minor\n[Em]la')).toContain('{key: Em}');
    expect(extractImportMeta('{title: Visa}\n\nTonart: A moll\n[Am]la')).toContain('{key: Am}');
    const out = extractImportMeta('{title: Visa 2017-05-14 09:38 Text & Music: Anna}\n\n[C]la\n\nVisa 2017-05-14 09:38\n[G]mer');
    expect(out).toContain('{title: Visa}');
    expect(out).toContain('{artist: Anna}');
    expect(out).not.toContain('2017');
  });
});

describe('OCR', () => {
  it('bindestreck mellan stavelser är inga linjer', () => {
    const out = ocrToChordPro([
      page(
        line(word('G', 260, 100, 15, 20), word('C', 400, 100, 15, 20)),
        line(word('Mor', 200, 125, 40, 20), word('-', 245, 133, 12, 3), word('gon', 260, 125, 40, 20), word('dagg', 400, 125, 50, 20)),
      ),
    ]);
    expect(out).toContain('Mor[G]gon [C]dagg');
  });

  it('sångtext som börjar med "Tag" eller "Slut" är ingen rubrik', () => {
    const out = ocrToChordPro([
      page(
        line(word('G', 300, 100, 15), word('C', 500, 100, 15)),
        line(word('Tag', 100, 130, 50), word('min', 170, 130, 50), word('hand', 300, 130, 70), word('nu', 500, 130, 30)),
        line(word('G', 300, 200, 15)),
        line(word('Slut', 100, 230, 60), word('är', 180, 230, 30), word('natten', 300, 230, 90)),
      ),
    ]);
    expect(out).toContain('Tag min [G]hand [C]nu');
    expect(out).toContain('Slut är [G]natten');
    expect(out).not.toContain('{comment');
  });

  it('"O o o o", räkning och nummer är inga ackordscheman', () => {
    const fingers = (y: number, s: string) => line(...s.split(' ').map((t, i) => word(t, 100 + i * 30, y, 15)));
    const out = ocrToChordPro([
      page(
        line(word('G', 100, 100, 15), word('Am', 220, 100, 30)),
        fingers(130, 'O o o o o o'),
        line(word('Räkna', 100, 200, 80)),
        fingers(230, '1 2 3 4'),
        line(word('CCLI', 100, 300, 60), word('123456', 180, 300, 90)),
      ),
    ]);
    expect(out).toContain('[G]O o o o [Am]o o');
    expect(out).toContain('1 2 3 4');
    expect(out).toContain('CCLI 123456');
  });

  it('ett ensamt sidnummer blir inget ackord', () => {
    const out = ocrToChordPro([page(line(word('G', 100, 100, 15)), line(word('Solen', 100, 130, 80)), line(word('6', 500, 900, 15)))]);
    expect(out).not.toMatch(/^\[G\]\s*$/m);
    expect(out.trim().endsWith('6')).toBe(true);
  });

  it('en längre högerspalt längst ner är ingen sidfot', () => {
    const out = ocrToChordPro([
      page(
        line(word('Vänster', 100, 100, 100)),
        line(word('Höger', 600, 100, 100)),
        line(word('Spalten', 600, 850, 100)),
        line(word('fortsätter', 600, 880, 140)),
      ),
    ]);
    expect(out).not.toContain('{comment');
  });
});
