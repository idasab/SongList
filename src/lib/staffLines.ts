// Notlinjerna i en bild av noter. Bilden delas i lodräta remsor, så att även sneda eller böjda
// linjer (foton, handskrivet) hittas: i varje remsa letas fem rader med bläck på lika avstånd.

/** En notrad (fem linjer) i en remsa av bilden */
export interface StaffPart {
  x0: number;
  x1: number;
  /** Linjernas y mitt i remsan, uppifrån och ner */
  lines: number[];
  /** Linjernas lutning (y per x) */
  slope: number;
}

/** Linjens y vid x */
export function lineY(part: StaffPart, line: number, x: number): number {
  return part.lines[line] + part.slope * (x - (part.x0 + part.x1) / 2);
}

/** Lutningarna som provas i varje remsa (upp till knappt 3°); den som ger skarpast linjer vinner */
const SLOPES = Array.from({ length: 21 }, (_, i) => (i - 10) * 0.005);

/** En notrad i hela bilden: delarna från vänster till höger */
export interface Staff {
  parts: StaffPart[];
}

/** Avståndet mellan linjerna i en del */
export function lineGap(part: StaffPart): number {
  return (part.lines[4] - part.lines[0]) / 4;
}

/**
 * Notraderna i bilden, uppifrån och ner. ink är 1 för bläck och 0 för papper, rad för rad
 * (w × h). Ger inga notrader om linjerna inte går att hitta säkert.
 */
export function findStaves(ink: Uint8Array, w: number, h: number): Staff[] {
  const strips = Math.max(1, Math.min(16, Math.round(w / 200)));
  const found: { x0: number; x1: number; slope: number; ys: number[] }[] = [];
  for (let s = 0; s < strips; s++) {
    const x0 = Math.round((s * w) / strips);
    const x1 = Math.round(((s + 1) * w) / strips);
    const xc = (x0 + x1) / 2;
    // Bläcket i remsan räknas rad för rad längs varje lutning
    const xs: number[] = [];
    const ys: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = x0, i = y * w + x0; x < x1; x++, i++) {
        if (ink[i]) {
          xs.push(x - xc);
          ys.push(y);
        }
      }
    }
    let best: Float32Array | null = null;
    let bestScore = -1;
    let slope = 0;
    for (const k of SLOPES) {
      const profile = new Float32Array(h);
      for (let n = 0; n < xs.length; n++) {
        const y = Math.round(ys[n] - k * xs[n]);
        if (y >= 0 && y < h) profile[y]++;
      }
      let score = 0;
      for (let y = 0; y < h; y++) score += profile[y] * profile[y];
      if (score > bestScore) {
        best = profile;
        bestScore = score;
        slope = k;
      }
    }
    found.push({ x0, x1, slope, ys: peaks(best!.map((n) => n / (x1 - x0))) });
  }

  // Linjeavståndet: det vanligaste avståndet mellan två linjer i rad (varje notrad ger fyra).
  // Utan det kan t.ex. en textrad ovanför paras ihop med linjer långt bort.
  const count = new Float32Array(Math.ceil(h / 4) + 2);
  for (const { ys } of found) {
    for (let i = 1; i < ys.length; i++) {
      const d = Math.round(ys[i] - ys[i - 1]);
      if (d >= 4 && d < count.length - 1) count[d]++;
    }
  }
  let mode = 0;
  let most = 0;
  for (let d = 4; d < count.length - 1; d++) {
    const n = count[d - 1] + count[d] + count[d + 1];
    if (n > most) {
      mode = d;
      most = n;
    }
  }
  if (!mode) return [];
  const gap = (mode * count[mode] + (mode - 1) * count[mode - 1] + (mode + 1) * count[mode + 1]) / (count[mode - 1] + count[mode] + count[mode + 1]);
  const parts: StaffPart[] = found.flatMap(({ x0, x1, slope, ys }) => fiveLines(ys, gap).map((lines) => ({ x0, x1, lines, slope })));

  // Delarna i en notrad följer varandra över bilden
  const centre = (p: StaffPart) => (p.x0 + p.x1) / 2;
  const groups: StaffPart[][] = [];
  for (const part of parts.sort((a, b) => a.x0 - b.x0)) {
    const group = groups.find((g) => {
      const last = g[g.length - 1];
      return last.x0 < part.x0 && Math.abs(lineY(last, 2, centre(part)) - part.lines[2]) < gap * 2.5;
    });
    if (group) group.push(part);
    else groups.push([part]);
  }
  // En del som hamnat en linje fel (t.ex. en balk tagen för en linje) stämmer inte med de andra
  const agree = (a: StaffPart, b: StaffPart) =>
    Math.abs(a.lines[2] + ((a.slope + b.slope) / 2) * (centre(b) - centre(a)) - b.lines[2]) < gap * 0.5;
  const minParts = strips <= 2 ? 1 : Math.ceil(strips / 3);
  return groups
    .map((g) => {
      const votes = g.map((p) => g.filter((q) => agree(q, p)).length);
      const best = g[votes.indexOf(Math.max(...votes))];
      return { parts: g.filter((p) => agree(best, p)) };
    })
    .filter((st) => st.parts.length >= minParts)
    .sort((a, b) => a.parts[0].lines[2] - b.parts[0].lines[2]);
}

/** Raderna med mycket bläck (linjer): mitten av varje sammanhängande stycke */
function peaks(profile: Float32Array): number[] {
  const h = profile.length;
  const smooth = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    smooth[y] = (profile[Math.max(0, y - 1)] + 2 * profile[y] + profile[Math.min(h - 1, y + 1)]) / 4;
  }
  // Sneda linjer sprids över flera rader, så gränsen är låg; fem linjer på lika avstånd sorterar bort resten
  const limit = 0.2;
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    if (smooth[y] < limit) continue;
    let sum = 0;
    let weight = 0;
    for (; y < h && smooth[y] >= limit; y++) {
      sum += y * smooth[y];
      weight += smooth[y];
    }
    out.push(sum / weight);
  }
  return out;
}

/**
 * Fem linjer på lika avstånd, nära linjeavståndet expected; det minsta avståndet som går vinner
 * (streck mellan linjerna hoppas över)
 */
function fiveLines(ys: number[], expected: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ys.length; i++) {
    let found: number[] | null = null;
    for (let j = i + 1; j < ys.length && !found; j++) {
      const gap = ys[j] - ys[i];
      if (gap < expected * 0.8) continue;
      if (gap > expected * 1.25) break;
      const idx = [i, j];
      for (let k = 2; k < 5; k++) {
        const last = ys[idx[k - 1]];
        const want = last + (last - ys[i]) / (k - 1);
        let best = -1;
        for (let m = idx[k - 1] + 1; m < ys.length && ys[m] < want + gap; m++) {
          if (Math.abs(ys[m] - want) <= gap * 0.2 && (best < 0 || Math.abs(ys[m] - want) < Math.abs(ys[best] - want))) best = m;
        }
        if (best < 0) break;
        idx.push(best);
      }
      if (idx.length === 5) found = idx;
    }
    if (found) {
      out.push(found.map((n) => ys[n]));
      i = found[4];
    }
  }
  return out;
}

/** Den nedersta linjens ton (diatoniskt steg, mellersta C = 28) för varje klav */
const BOTTOM_LINE: Record<string, number> = { treble: 30, 'treble-8': 30, alto: 24, tenor: 22, bass: 18 };
export const CLEFS = Object.keys(BOTTOM_LINE);

/** Tonen step halva linjeavstånd ovanför den nedersta linjen, som ABC-namn (C, c', B,,) */
export function pitchName(clef: string, step: number): string {
  const d = BOTTOM_LINE[clef] + step;
  const octave = Math.floor(d / 7);
  const letter = 'CDEFGAB'[d - octave * 7];
  return octave >= 5 ? letter.toLowerCase() + "'".repeat(octave - 5) : letter + ','.repeat(4 - octave);
}
