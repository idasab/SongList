import { describe, expect, it } from 'vitest';
import { beatsPerBar, parseTempo, tapTempo } from './metronome';

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

describe('knacka tempo', () => {
  it('medelvärdet av de senaste mellanrummen', () => {
    expect(tapTempo([0])).toBeUndefined();
    expect(tapTempo([0, 500])).toBe(120);
    // Ett ojämnt slag jämnas ut
    expect(tapTempo([0, 600, 1250, 1875, 2500])).toBe(96);
    // Bara de senaste åtta mellanrummen räknas
    const slow = [0, 1000, 2000];
    const fast = Array.from({ length: 9 }, (_, i) => 3000 + i * 500);
    expect(tapTempo([...slow, ...fast])).toBe(120);
    expect(tapTempo([0, 10])).toBeUndefined();
  });
});
