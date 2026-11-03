// Noter i ABC-format, inbäddade i ChordPro med {start_of_abc} … {end_of_abc}.
// abcjs (stort paket) laddas först när noter ska visas, spelas eller transponeras.
import { parseDirective } from './chordpro';

type Abcjs = typeof import('abcjs');

let abcjs: Promise<Abcjs> | null = null;

export function loadAbcjs(): Promise<Abcjs> {
  abcjs ??= import('abcjs').then((m) => ((m as { default?: Abcjs }).default ?? m) as Abcjs);
  return abcjs;
}

/** Sant om källtexten har noter */
export function hasAbc(source: string): boolean {
  return source.split(/\r?\n/).some((l) => l.trim().startsWith('{') && parseDirective(l)?.name === 'start_of_abc');
}

/** Raderna i varje notblock: [första raden, raden efter sista] */
export function abcRanges(lines: string[]): [number, number][] {
  const ranges: [number, number][] = [];
  let start = -1;
  lines.forEach((l, i) => {
    const name = l.trim().startsWith('{') ? parseDirective(l)?.name : undefined;
    if (start < 0 && name === 'start_of_abc') start = i + 1;
    else if (start >= 0 && name === 'end_of_abc') {
      ranges.push([start, i]);
      start = -1;
    }
  });
  if (start >= 0) ranges.push([start, lines.length]);
  return ranges;
}

/** Skriver in en transponering (i halvtoner) i noterna; resten av texten lämnas som den är */
export async function transposeAbcSource(source: string, steps: number): Promise<string> {
  if (!steps || !hasAbc(source)) return source;
  const lib = await loadAbcjs();
  const lines = source.split(/\r?\n/);
  // Bakifrån, så att radnumren för blocken före stämmer även om antalet rader ändras
  for (const [from, to] of abcRanges(lines).reverse()) {
    const abc = lines.slice(from, to).join('\n');
    if (!abc.trim()) continue;
    // "*": tolkas utan att ritas
    const tunes = lib.renderAbc('*', abc);
    const moved = lib.strTranspose(abc, tunes, steps).replace(/\n+$/, '');
    lines.splice(from, to - from, ...moved.split('\n'));
  }
  return lines.join('\n');
}
