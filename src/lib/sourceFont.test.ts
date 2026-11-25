import { describe, expect, it } from 'vitest';
import { chordFit, monospaceMeasure, suggestSourceFont, type Measure, type SourceFont } from './textImport';

/** Påhittat typsnitt: alla tecken är 1 bred, mellanslaget så brett som angetts. */
const font =
  (space: number): Measure =>
  (t) =>
    [...t].reduce((w, ch) => w + (ch === ' ' ? space : 1), 0);

const narrow = font(0.25);
const wide = font(0.5);
// Arial och Helvetica mäter likadant; de andra har bredare mellanslag
const measureFor = (f: SourceFont): Measure => (f === 'monospace' ? monospaceMeasure : f === 'Arial' || f === 'Helvetica' ? narrow : wide);

// Skrivet i det smala typsnittet: varje ackord står över början av ett ord (17 mellanslag
// à 0,25 räcker från ett ackord till nästa ord)
const gap = ' '.repeat(17);
const inNarrow = [`C${gap}G${gap}Am`, 'Hello world again', '', `F${gap}C${gap}G`, 'Never stops again'].join('\n');

describe('gissa typsnittet en text skrevs med', () => {
  it('väljer typsnittet där ackorden står över orden', () => {
    expect(chordFit(inNarrow, narrow).score).toBe(1);
    expect(chordFit(inNarrow, monospaceMeasure).score).toBeLessThan(0);
    expect(suggestSourceFont(inNarrow, measureFor)).toBe('Arial');
  });

  it('lika bra typsnitt avgörs av ordningen, och typsnitt som saknas hoppas över', () => {
    expect(suggestSourceFont(inNarrow, measureFor, ['monospace', 'Helvetica', 'Arial'])).toBe('Helvetica');
    expect(suggestSourceFont(inNarrow, measureFor, ['monospace', 'Verdana'])).toBe('monospace');
  });

  it('text skriven med fast teckenbredd förblir fast teckenbredd', () => {
    const mono = ['C     G     Am', 'Hello world again', '', 'F    C     G', 'Sing along with'].join('\n');
    expect(suggestSourceFont(mono, measureFor)).toBe('monospace');
  });

  it('utan ackord över text: fast teckenbredd', () => {
    expect(suggestSourceFont('Bara text\nutan ackord', measureFor)).toBe('monospace');
  });
});
