// Sådant som förekommer i riktiga ChordPro-filer (påhittad text).
import { describe, expect, it } from 'vitest';
import { parseChordPro, transposeSource } from './chordpro';
import { formatChord, isAnnotationChord } from './chords';
import { parseHeader } from './layout';
import { convertChordsAboveInChordPro } from './textImport';

const sections = (src: string) => parseChordPro(src).sections.map((s) => `${s.label ?? s.type}${s.isRepeat ? '*' : ''}:${s.lines.length}`);
const up2 = { transpose: 2, notation: 'international' as const };

describe('ackord som inte är vanliga ackord', () => {
  it('ny bas och flera ackord i samma hakparentes transponeras', () => {
    expect(formatChord('/F#', up2)).toBe('/G#');
    expect(formatChord('-/A', up2)).toBe('-/B');
    expect(formatChord('(/D#)', up2)).toBe('(/F)');
    expect(formatChord('Dsus D', up2)).toBe('Esus E');
    expect(formatChord('/F#', { ...up2, simplify: true })).toBe('/G#');
    expect(transposeSource('[G]a [/F#]b', up2)).toBe('[A]a [/G#]b');
  });

  it('text i hakparentes som inte är ackord visas som anteckning', () => {
    expect(isAnnotationChord('(x4)')).toBe(true);
    expect(isAnnotationChord('(till vers')).toBe(true);
    expect(isAnnotationChord('*Lugnt')).toBe(true);
    expect(isAnnotationChord('/F#')).toBe(false);
    expect(isAnnotationChord('Am7')).toBe(false);
    expect(formatChord('(x4)', up2)).toBe('(x4)');
    // Bara riktiga ackord i låtens ackordlista
    expect(parseChordPro('[G]a [(x2)]b [/F#]c').chords).toEqual(['G']);
  });
});

describe('rubriker', () => {
  it('antal gånger och anteckning i parentes', () => {
    expect(parseHeader('Stick x2:')).toEqual({ kind: 'bridge', label: 'Stick x2' });
    expect(parseHeader('Intro 2x:')).toEqual({ kind: 'comment', label: 'Intro x2' });
    expect(parseHeader('Refräng (x3):')).toEqual({ kind: 'chorus', label: 'Refräng x3' });
    expect(parseHeader('Refräng (1a lugn):')).toEqual({ kind: 'chorus', label: 'Refräng (1a lugn)' });
    expect(parseHeader('Vrs 2:')).toEqual({ kind: 'verse', label: 'Vrs 2' });
  });

  it('delens namn i hakparentes och andra korta rader med kolon', () => {
    expect(sections('[Chorus]\n\n[C]Sjung nu\n\n\n[Verse]\n\n[G]Solen\n\n\n[Chorus]\n\n[C]Sjung nu')).toEqual(['Chorus:1', 'Verse:1', 'Chorus:1']);
    const lines = parseChordPro('[Intro]\n[C] [G]\n\nOriginal:\n[C]a\n\nHan sa:\n[G]b').sections.flatMap((s) => s.lines);
    expect(lines.filter((l) => l.type === 'comment').map((l) => (l.type === 'comment' ? l.text : ''))).toEqual(['Intro', 'Original', 'Han sa']);
  });

  it('"Brygga:" utan text upprepar bryggan', () => {
    expect(sections('Vers 1:\n[G]a\n\nBrygga:\n[C]b\n\nRefräng:\n[D]c\n\nVers 2:\n[G]d\n\nBrygga:\nRefräng:\n\nVers 3:\n[G]e')).toEqual([
      'Vers 1:1',
      'Brygga:1',
      'Refräng:1',
      'Vers 2:1',
      'Brygga*:1',
      'Refräng*:1',
      'Vers 3:1',
    ]);
  });
});

describe('ackord ovanför texten i en ChordPro-fil', () => {
  it('görs om, men inte rader med hakparenteser, direktiv eller tabulatur', () => {
    const src = [
      '{title: Visa}',
      'G      C',
      'Solen går upp',
      '[Am]Månen',
      '{sot}',
      'G C D',
      '{eot}',
      'G   D',
    ].join('\n');
    expect(convertChordsAboveInChordPro(src).split('\n')).toEqual(['{title: Visa}', '[G]Solen g[C]år upp', '[Am]Månen', '{sot}', 'G C D', '{eot}', '[G]   [D]']);
  });
});
