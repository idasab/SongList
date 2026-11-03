// Notlinjerna i en bild av noter. Bilden delas i lodräta remsor, så att även sneda eller böjda
// linjer (foton, handskrivet) hittas: i varje remsa letas fem rader med bläck på lika avstånd.

/** En notrad (fem linjer) i en remsa av bilden */
export interface StaffPart {
  x0: number;
  x1: number;
  /** Linjernas y, uppifrån och ner */
  lines: number[];
}

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
  let parts: StaffPart[] = [];
  for (let s = 0; s < strips; s++) {
    const x0 = Math.round((s * w) / strips);
    const x1 = Math.round(((s + 1) * w) / strips);
    const profile = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let x = x0, i = y * w + x0; x < x1; x++, i++) n += ink[i];
      profile[y] = n / (x1 - x0);
    }
    for (const lines of fiveLines(peaks(profile))) parts.push({ x0, x1, lines });
  }
  if (!parts.length) return [];

  // Alla notrader har ungefär samma linjeavstånd
  const gaps = parts.map(lineGap).sort((a, b) => a - b);
  const gap = gaps[gaps.length >> 1];
  parts = parts.filter((p) => Math.abs(lineGap(p) - gap) <= gap * 0.25);

  // Delarna i en notrad följer varandra; en del som hamnat en linje fel blir en egen (för kort) notrad
  const staves: Staff[] = [];
  for (const part of parts.sort((a, b) => a.x0 - b.x0)) {
    const staff = staves.find((st) => {
      const last = st.parts[st.parts.length - 1];
      return last.x0 < part.x0 && Math.abs(last.lines[2] - part.lines[2]) < gap * 0.6;
    });
    if (staff) staff.parts.push(part);
    else staves.push({ parts: [part] });
  }
  const minParts = strips <= 2 ? 1 : Math.ceil(strips / 3);
  return staves
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

/** Fem linjer på lika avstånd; det minsta avståndet som går vinner (streck mellan linjerna hoppas över) */
function fiveLines(ys: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ys.length; i++) {
    let found: number[] | null = null;
    for (let j = i + 1; j < ys.length && !found; j++) {
      const gap = ys[j] - ys[i];
      if (gap < 4) continue;
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
