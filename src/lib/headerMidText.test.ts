import { describe, expect, it } from 'vitest';
import { parseChordPro } from './chordpro';
import { textToChordPro } from './textImport';

const labels = (src: string) => parseChordPro(src).sections.map((s) => s.label ?? '');
const comments = (src: string) =>
  parseChordPro(src).sections.flatMap((s) => s.lines.filter((l) => l.type === 'comment').map((l) => (l.type === 'comment' ? l.text : '')));

describe('en rubrik kan inte ligga mitt i en text', () => {
  it('en rad med kolon direkt under en textrad är text', () => {
    const src = ['Vers 1:', '[G]Hon tittade upp och', 'Sa till mig:', '[C]Kom hit nu'].join('\n');
    expect(labels(src)).toEqual(['Vers 1']);
    expect(comments(src)).toEqual([]);
    const lyrics = parseChordPro(src).sections[0].lines.filter((l) => l.type === 'lyrics');
    expect(lyrics).toHaveLength(3);
  });

  it('även namn på delar: "Refräng:" mitt i en text är text', () => {
    const src = ['Vers:', 'Första raden', 'Refräng:', 'Sista raden'].join('\n');
    expect(labels(src)).toEqual(['Vers']);
  });

  it('efter en tomrad, en ackordrad, en annan rubrik eller i början är det en rubrik', () => {
    expect(labels(['Vers 1:', 'Text', '', 'Refräng:', 'Mer text'].join('\n'))).toEqual(['Vers 1', 'Refräng']);
    expect(labels(['Intro:', '[G] [C] [D]', 'Vers 1:', 'Text'].join('\n'))).toEqual(['', 'Vers 1']);
    expect(comments(['Intro:', 'Vers 1:', 'Text'].join('\n'))).toEqual(['Intro']);
    expect(labels(['Text', '{start_of_chorus}', 'Refräng:', 'x'].join('\n'))[0]).toBe('');
  });

  it('hakparentes och ackord efter kolon är alltid rubriker', () => {
    expect(labels(['Vers:', 'Text', '[Chorus]', 'Mer'].join('\n'))).toEqual(['Vers', 'Chorus']);
    expect(comments(['Text', 'Intro: G C D'].join('\n'))).toEqual(['Intro']);
  });

  it('import av text med ackord ovanför följer samma regel', () => {
    const out = textToChordPro(['Vers 1:', 'G', 'Hon tittade upp och', 'Sa till mig:', 'C', 'Kom hit nu', '', 'Refräng:', 'Text'].join('\n'));
    expect(out).toContain('{start_of_verse: Vers 1}');
    expect(out).toContain('Sa till mig:');
    expect(out).not.toContain('{comment: Sa till mig}');
    expect(out).toContain('{start_of_chorus: Refräng}');
  });
});
