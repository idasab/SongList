import { describe, expect, it } from 'vitest';
import { parseChordPro, transposeSource } from './chordpro';
import { abcRanges, hasAbc } from './abc';

const SONG = `{title: Test}
{key: G}
Text [G]före
{start_of_abc}
X:1
K:G
[V:S] "G"{g}G A B c |
# inte en kommentar i ABC
{end_of_abc}
[D]Efter`;

describe('noter (ABC)', () => {
  it('noterna blir en egen del med raderna orörda', () => {
    const p = parseChordPro(SONG);
    const abc = p.sections.find((s) => s.type === 'abc');
    expect(abc?.lines.map((l) => (l.type === 'pre' ? l.text : '?'))).toEqual([
      'X:1',
      'K:G',
      '[V:S] "G"{g}G A B c |',
      '# inte en kommentar i ABC',
    ]);
    // Ackorden i noterna räknas inte som låtens ackord
    expect(p.chords).toEqual(['G', 'D']);
    // Texten efter noterna tolkas som vanligt
    expect(p.sections.at(-1)?.lines[0].type).toBe('lyrics');
  });

  it('transponering av ackorden lämnar noterna orörda', () => {
    const out = transposeSource(SONG, { transpose: 2, preferFlats: false, notation: 'international' });
    expect(out).toContain('Text [A]före');
    expect(out).toContain('[E]Efter');
    expect(out).toContain('{key: A}');
    expect(out).toContain('[V:S] "G"{g}G A B c |');
  });

  it('hittar notblocken', () => {
    expect(hasAbc(SONG)).toBe(true);
    expect(hasAbc('{title: x}\n[C]la')).toBe(false);
    expect(abcRanges(SONG.split('\n'))).toEqual([[4, 8]]);
  });
});
