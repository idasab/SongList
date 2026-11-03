import { describe, expect, it } from 'vitest';
import { parseChordPro, transposeSource } from './chordpro';
import { abcKey, abcRanges, abcToChordPro, hasAbc } from './abc';
import { lineUnit, strokeFromPx, strokeToPx } from './annotations';

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

  it('tonarten i K: blir ett ackordnamn', () => {
    expect(abcKey('G')).toBe('G');
    expect(abcKey('Em')).toBe('Em');
    expect(abcKey('F#min clef=bass')).toBe('F#m');
    expect(abcKey('Bbmaj')).toBe('Bb');
    expect(abcKey('Ador')).toBeUndefined();
    expect(abcKey('none')).toBeUndefined();
  });

  it('noter blir en ny låt med uppgifterna ur noterna', () => {
    const song = abcToChordPro('X:1\nT:Psalm\nC:Okänd\nM:3/4\nL:1/4\nQ:1/4=96\nK:Dm\n"Dm"D E F |]\n');
    expect(song).toBe(
      '{title: Psalm}\n{composer: Okänd}\n{key: Dm}\n{time: 3/4}\n{tempo: 96}\n{start_of_abc}\nX:1\nT:Psalm\nC:Okänd\nM:3/4\nL:1/4\nQ:1/4=96\nK:Dm\n"Dm"D E F |]\n{end_of_abc}\n',
    );
    const p = parseChordPro(song);
    expect(p.meta.title).toBe('Psalm');
    expect(p.meta.key).toBe('Dm');
    expect(abcToChordPro('X:1\nK:C\nC D E F|', 'Från fil')).toContain('{title: Från fil}');
  });

  it('anteckningar på ihoptryckta noter följer noterna', () => {
    // Rad 1 är noter som ritas i halv storlek
    const small = { tops: [0, 100], fontPx: 20, scales: [1, 0.5] };
    const s = strokeFromPx(small, [140, 120, 160, 130], 'red', 0.2, 'x');
    expect(s.anchor).toEqual({ line: 1, dx: 14, dy: 2 });
    // Samma bredd på skärmen som när det ritades
    expect(s.width * lineUnit(small, 1)).toBeCloseTo(0.2 * 20);
    // Får noterna full storlek växer strecket med dem
    const full = { ...small, scales: [1, 1] };
    expect(strokeToPx(full, s)).toEqual([280, 140, 320, 160]);
    // Utan skalor är allt som förut
    expect(lineUnit({ tops: [0], fontPx: 20 }, 0)).toBe(20);
  });

  it('hittar notblocken', () => {
    expect(hasAbc(SONG)).toBe(true);
    expect(hasAbc('{title: x}\n[C]la')).toBe(false);
    expect(abcRanges(SONG.split('\n'))).toEqual([[4, 8]]);
  });
});
