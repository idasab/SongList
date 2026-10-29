import { describe, expect, it } from 'vitest';
import { enhancePixels } from './enhance';

/** Ett gråaktigt "foto": papper som blir mörkare åt höger, med svarta streck (noter) på. */
function photo(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  const ink = (x: number, y: number) => y % 20 === 10 || (x % 37 < 3 && y > 30 && y < 70);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const paper = 200 - (x / w) * 80; // 200 till vänster, 120 till höger
      const v = ink(x, y) ? paper * 0.4 : paper;
      const p = (y * w + x) * 4;
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v * 0.9;
      data[p + 3] = 255;
    }
  }
  return { data, ink };
}

describe('enhancePixels', () => {
  it('gör papperet vitt och strecken svarta, även där ljuset är sämre', () => {
    const w = 400;
    const h = 120;
    const { data, ink } = photo(w, h);
    enhancePixels(data, w, h);
    for (const x of [20, 200, 380]) {
      // Papper (en bit från strecken)
      expect(data[(5 * w + x) * 4]).toBeGreaterThan(245);
      // Streck
      expect(ink(x, 10)).toBe(true);
      expect(data[(10 * w + x) * 4]).toBeLessThan(30);
    }
  });

  it('ger gråskala utan genomskinlighet', () => {
    const w = 64;
    const h = 64;
    const { data } = photo(w, h);
    enhancePixels(data, w, h);
    for (let p = 0; p < data.length; p += 4) {
      expect(data[p]).toBe(data[p + 1]);
      expect(data[p]).toBe(data[p + 2]);
      expect(data[p + 3]).toBe(255);
    }
  });
});
