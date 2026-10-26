import { describe, expect, it } from 'vitest';
import { beatsPerBar, parseTempo } from './metronome';

describe('metronom', () => {
  it('tempo från {tempo}', () => {
    expect(parseTempo('96')).toBe(96);
    expect(parseTempo('96 bpm')).toBe(96);
    expect(parseTempo('♩=120')).toBe(120);
    expect(parseTempo('ca 72,5')).toBe(72.5);
    expect(parseTempo('Lugnt')).toBeUndefined();
    expect(parseTempo('5')).toBeUndefined();
    expect(parseTempo('900')).toBeUndefined();
    expect(parseTempo(undefined)).toBeUndefined();
  });

  it('slag per takt från {time}', () => {
    expect(beatsPerBar('3/4')).toBe(3);
    expect(beatsPerBar(' 6 / 8 ')).toBe(6);
    expect(beatsPerBar('4/4')).toBe(4);
    expect(beatsPerBar(undefined)).toBe(4);
    expect(beatsPerBar('C')).toBe(4);
    expect(beatsPerBar('0/4')).toBe(4);
  });
});
