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

/** Värdet i ett fält i ABC-huvudet, t.ex. "T" för titeln */
function abcField(abc: string, field: string): string | undefined {
  const m = new RegExp(`^${field}:\\s*(.*)$`, 'm').exec(abc);
  return m?.[1].trim() || undefined;
}

/** Tonarten i K: som ackordnamn (G, Em, Bb); kyrkotonarter och "none" ger ingen */
export function abcKey(k: string | undefined): string | undefined {
  const m = /^([A-G][#b]?)\s*(maj(?:or)?|min(?:or)?|m)?(?=\s|$)/i.exec(k?.trim() ?? '');
  if (!m) return undefined;
  const root = m[1][0].toUpperCase() + m[1].slice(1);
  return /^m(in)?/i.test(m[2] ?? '') && !/^maj/i.test(m[2] ?? '') ? `${root}m` : root;
}

/** En ny låt (ChordPro) med noterna; titel, kompositör, tonart, takt och tempo hämtas ur noterna */
export function abcToChordPro(abc: string, fallbackTitle = 'Noter'): string {
  const body = abc.replace(/\r\n?/g, '\n').trim();
  // Fälten i huvudet kommer först: ett senare K: eller M: är ett byte längre ner
  const tempo = /(?:=\s*)?(\d{2,3})\s*$/.exec(abcField(body, 'Q') ?? '')?.[1];
  const lines = [
    `{title: ${abcField(body, 'T') ?? fallbackTitle}}`,
    ...[
      ['composer', abcField(body, 'C')],
      ['key', abcKey(abcField(body, 'K'))],
      ['time', abcField(body, 'M')],
      ['tempo', tempo],
    ]
      .filter(([, v]) => v)
      .map(([k, v]) => `{${k}: ${v}}`),
    '{start_of_abc}',
    body,
    '{end_of_abc}',
  ];
  return lines.join('\n') + '\n';
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
