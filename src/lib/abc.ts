// Noter i ABC-format, inbäddade i ChordPro med {start_of_abc} … {end_of_abc}.
// abcjs (stort paket) laddas först när noter ska visas, spelas eller transponeras.
import { parseDirective } from './chordpro';

type Abcjs = typeof import('abcjs');

let abcjs: Promise<Abcjs> | null = null;

/** Notbildens bredd i em (som låtens text). Får den inte plats trycks den ihop. */
export const ABC_WIDTH_EM = 36;
/** Notraderna ritas så här breda (abcjs-enheter) och skalas sedan till ABC_WIDTH_EM */
export const ABC_STAFF_WIDTH = 740;

export function loadAbcjs(): Promise<Abcjs> {
  abcjs ??= import('abcjs').then((m) => ((m as { default?: Abcjs }).default ?? m) as Abcjs);
  return abcjs;
}

/**
 * Noterna som de ritas: titel och kompositör står redan i låtens huvud, så de görs om till
 * kommentarer i ABC-huvudet (före första K:) i stället för att ta plats ovanför noterna.
 * Texten blir lika lång, så att abcjs teckenpositioner stämmer med originalet.
 */
export function abcForDisplay(abc: string): string {
  const lines = abc.split('\n');
  const k = lines.findIndex((l) => /^K:/.test(l));
  return lines.map((l, i) => (i < k && /^[TC]:/.test(l) ? '%' + l.slice(1) : l)).join('\n');
}

/** En ton i ABC-texten: var den står och hur hög den är (diatoniskt steg, mellersta C = 28) */
export interface AbcPitch {
  start: number;
  end: number;
  step: number;
}

/** Tonerna i ett stycke ABC (en not eller ett ackord som [GBd]2); ackordnamn, dekorationer och förslag räknas inte */
export function abcPitches(text: string): AbcPitch[] {
  // "Am", !p!, +fermata+ och {förslag} blankas ut (lika långt), så att bokstäverna i dem inte räknas
  const masked = text.replace(/"[^"]*"|![^!]*!|\+[^+]*\+|\{[^}]*\}/g, (m) => ' '.repeat(m.length));
  const out: AbcPitch[] = [];
  for (const m of masked.matchAll(/(\^\^|\^|__|_|=)?([A-Ga-g])([,']*)/g)) {
    const letter = m[2];
    const octave = (letter === letter.toLowerCase() ? 5 : 4) + (m[3].match(/'/g)?.length ?? 0) - (m[3].match(/,/g)?.length ?? 0);
    out.push({ start: m.index, end: m.index + m[0].length, step: octave * 7 + 'CDEFGAB'.indexOf(letter.toUpperCase()) });
  }
  return out;
}

/** Tonen som ABC (utan förtecken), t.ex. C, c', B,, */
export function abcPitchName(step: number): string {
  const octave = Math.floor(step / 7);
  const letter = 'CDEFGAB'[step - octave * 7];
  return octave >= 5 ? letter.toLowerCase() + "'".repeat(octave - 5) : letter + ','.repeat(4 - octave);
}

/**
 * Flyttar ton nummer index i stycket delta tonsteg (upp är plus). Ett förtecken på tonen tas bort:
 * det gällde den gamla tonen.
 */
export function moveAbcPitch(text: string, index: number, delta: number): string {
  const p = abcPitches(text)[index];
  if (!p) return text;
  return text.slice(0, p.start) + abcPitchName(p.step + delta) + text.slice(p.end);
}

/** Noterna (med toner, inte pauser) i ett notblock: start och slut i texten, i den ordning de står */
export async function abcNoteRanges(abc: string): Promise<[number, number][]> {
  const lib = await loadAbcjs();
  const [tune] = lib.renderAbc('*', abcForDisplay(abc));
  const out: [number, number][] = [];
  for (const line of tune?.lines ?? []) {
    for (const staff of line.staff ?? []) {
      for (const voice of staff.voices ?? []) {
        for (const el of voice) {
          const at = el as { el_type?: string; startChar?: number; endChar?: number; pitches?: unknown[] };
          if (at.el_type === 'note' && at.pitches?.length && at.startChar !== undefined && at.endChar !== undefined) {
            out.push([at.startChar, at.endChar]);
          }
        }
      }
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * Var i källtexten (rad och kolumn) ett tecken i notblock nummer block står. at räknas som abcjs
 * gör: i blockets rader (utan blanksteg i slutet) ihopsatta med radbrytningar.
 */
export function abcSourcePos(lines: string[], block: number, at: number): { line: number; col: number } | null {
  const range = abcRanges(lines)[block];
  if (!range) return null;
  let col = at;
  for (let i = range[0]; i < range[1]; i++) {
    const len = lines[i].replace(/\s+$/, '').length;
    if (col <= len) return { line: i, col };
    col -= len + 1;
  }
  return null;
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

/** Noterna som bilder (PNG), t.ex. för en PDF. w och h i abcjs-enheter (bredden ABC_STAFF_WIDTH). */
export interface AbcImage {
  data: string;
  w: number;
  h: number;
}

/**
 * Ritar noterna som bilder: en bild med alla noter, eller (perSystem) en bild per notrad, så
 * att de kan delas mellan sidor. Svart på vitt.
 */
export async function renderAbcImages(
  abc: string,
  opts: { transpose: number; swedish: boolean; perSystem?: boolean },
): Promise<AbcImage[]> {
  const lib = await loadAbcjs();
  // abcjs mäter texten, så noterna ritas i dokumentet (utom synhåll)
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:-10000px;top:0;width:${ABC_STAFF_WIDTH}px;color:#000`;
  document.body.appendChild(host);
  try {
    lib.renderAbc(host, abcForDisplay(abc), {
      visualTranspose: opts.transpose,
      germanAlphabet: opts.swedish,
      foregroundColor: '#000000',
      staffwidth: ABC_STAFF_WIDTH,
      oneSvgPerLine: !!opts.perSystem,
      paddingtop: 0,
      paddingbottom: 0,
      paddingleft: 0,
      paddingright: 0,
    });
    const out: AbcImage[] = [];
    for (const svg of host.querySelectorAll('svg')) {
      const box = svg.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      out.push({ data: await svgToPng(svg, box.width, box.height), w: box.width, h: box.height });
    }
    return out;
  } finally {
    host.remove();
  }
}

async function svgToPng(svg: SVGSVGElement, w: number, h: number): Promise<string> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(w));
  copy.setAttribute('height', String(h));
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copy));
  const img = new Image();
  img.src = url;
  await img.decode();
  // Dubbel upplösning, så att noterna blir skarpa i utskrift
  const k = 3;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * k);
  canvas.height = Math.ceil(h * k);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
