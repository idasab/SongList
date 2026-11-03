import { describe, expect, it } from 'vitest';
import { findStaves, lineGap, pitchName } from './staffLines';

/** En bild med notrader (linjerna lutar slope px per px) och lite annat bläck: noter, en balk och text */
function sheet(w: number, h: number, tops: number[], gap: number, slope = 0) {
  const ink = new Uint8Array(w * h);
  const set = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < w && y < h) ink[Math.round(y) * w + Math.round(x)] = 1;
  };
  for (const top of tops) {
    for (let x = 0; x < w; x++) {
      for (let l = 0; l < 5; l++) {
        set(x, top + l * gap + x * slope);
        set(x, top + l * gap + x * slope + 1);
      }
    }
    // Noter (prickar) mellan och på linjerna, med skaft
    for (let x = 40; x < w; x += 70) {
      const y = top + ((x / 70) % 9) * (gap / 2) + x * slope;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -4; dx <= 4; dx++) set(x + dx, y + dy);
      for (let dy = 0; dy < gap * 3; dy++) set(x + 4, y - dy);
    }
    // En tjock balk ovanför och en rad text under
    for (let x = 300; x < 520; x++) for (let t = 0; t < 4; t++) set(x, top - gap * 1.5 + t + x * slope);
    for (let x = 0; x < w; x++) for (let t = 0; t < 8; t++) if (x % 9 < 5) set(x, top + gap * 7 + t + x * slope);
  }
  return ink;
}

describe('findStaves', () => {
  it('hittar raka notrader och deras linjer', () => {
    const staves = findStaves(sheet(1200, 500, [60, 300], 18), 1200, 500);
    expect(staves).toHaveLength(2);
    for (const [i, top] of [60, 300].entries()) {
      for (const part of staves[i].parts) {
        expect(lineGap(part)).toBeCloseTo(18, 0);
        expect(part.lines[0]).toBeCloseTo(top + 0.5, 0);
      }
    }
  });

  it('följer sneda linjer över bilden', () => {
    const slope = 0.03; // 1,7°
    const staves = findStaves(sheet(1600, 500, [80], 20, slope), 1600, 500);
    expect(staves).toHaveLength(1);
    const parts = staves[0].parts;
    expect(parts.length).toBeGreaterThanOrEqual(6);
    for (const part of parts) {
      const mid = (part.x0 + part.x1) / 2;
      expect(Math.abs(part.lines[0] - (80.5 + mid * slope))).toBeLessThan(2);
    }
  });

  it('ger inga notrader för en bild utan linjer', () => {
    const ink = new Uint8Array(800 * 300);
    for (let i = 0; i < ink.length; i += 7) ink[i] = 1;
    expect(findStaves(ink, 800, 300)).toEqual([]);
  });
});

describe('pitchName', () => {
  it('namnger linjer och mellanrum i ABC', () => {
    expect([0, 1, 2, 8, 9].map((s) => pitchName('treble', s))).toEqual(['E', 'F', 'G', 'f', 'g']);
    expect([-2, -3, -4, 12].map((s) => pitchName('treble', s))).toEqual(['C', 'B,', 'A,', "c'"]);
    expect([0, 1, 8, 10].map((s) => pitchName('bass', s))).toEqual(['G,,', 'A,,', 'A,', 'C']);
    expect(pitchName('alto', 4)).toBe('C');
  });
});
