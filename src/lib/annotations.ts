// Anteckningar på en låt: post-it-lappar och handritade streck.
//
// Allt fästs vid en rad i den renderade låten (ett "ankare") och mäts i em, dvs. i
// förhållande till låtens textstorlek. Då följer anteckningarna med texten när man ändrar
// textstorlek, transponerar, döljer ackord eller vrider skärmen.

export interface Anchor {
  /** Index för raden (data-ln) som anteckningen sitter vid */
  line: number;
  /** Avstånd från låtens vänsterkant, i em */
  dx: number;
  /** Avstånd från radens överkant, i em */
  dy: number;
}

export type InkColor = 'ink' | 'red' | 'blue' | 'green';
export type NoteColor = 'yellow' | 'pink' | 'green' | 'blue';

export interface Stroke {
  id: string;
  /** Ankare för strecket; punkterna är relativa till det */
  anchor: Anchor;
  /** Platt lista [x0, y0, x1, y1, …] i em relativt ankaret */
  points: number[];
  color: InkColor;
  /** Linjebredd i em */
  width: number;
}

export interface StickyNote {
  id: string;
  /** Lappens mittpunkt */
  anchor: Anchor;
  /** Bredd och höjd i em */
  w: number;
  h: number;
  /** Rotation i grader */
  rotation: number;
  text: string;
  /** Textstorlek i em relativt låtens text */
  fontSize: number;
  color: NoteColor;
}

export interface Annotations {
  strokes: Stroke[];
  notes: StickyNote[];
}

export const EMPTY_ANNOTATIONS: Annotations = { strokes: [], notes: [] };

export const INK_COLORS: Record<InkColor, string> = {
  ink: 'var(--text)',
  red: '#c62828',
  blue: '#2f6fdf',
  green: '#458268',
};

export const NOTE_COLORS: Record<NoteColor, string> = {
  yellow: '#fff1a6',
  pink: '#ffd3dd',
  green: '#d3f0dc',
  blue: '#d5e8ff',
};

export const INK_WIDTHS = [0.08, 0.14, 0.24];

export const NOTE_LIMITS = { minW: 3, maxW: 40, minH: 2, maxH: 40, minFont: 0.4, maxFont: 3 };

/**
 * Mått på den renderade låten: varje rads överkant i px och textstorleken i px. Visas låten
 * i spalter har varje rad även sin spalts vänsterkant (px från låtens vänsterkant); ankarets
 * dx räknas från den, så att en anteckning följer med sin rad mellan en och två spalter.
 */
export interface LineMetrics {
  tops: number[];
  fontPx: number;
  lefts?: number[];
}

function leftOf(m: LineMetrics, line: number): number {
  return m.lefts?.[Math.min(line, m.lefts.length - 1)] ?? 0;
}

/** Hittar raden som en punkt (px relativt låten) hör till och räknar ut ankaret. */
export function anchorAt(m: LineMetrics, x: number, y: number): Anchor {
  // Spalten som punkten ligger i: den närmaste vänsterkanten till vänster om punkten
  let col = 0;
  for (const l of m.lefts ?? []) if (l <= x && l > col) col = l;
  let line = -1;
  for (let i = 0; i < m.tops.length; i++) {
    const t = m.tops[i];
    if (t === undefined || Number.isNaN(t) || leftOf(m, i) !== col) continue;
    if (line < 0 || t <= y) line = i;
    else break;
  }
  if (line < 0) line = 0;
  const top = m.tops[line] ?? 0;
  return { line, dx: (x - leftOf(m, line)) / m.fontPx, dy: (y - top) / m.fontPx };
}

/** Ankarets position i px relativt låten. */
export function anchorToPx(m: LineMetrics, a: Anchor): { x: number; y: number } {
  const top = m.tops[Math.min(a.line, m.tops.length - 1)] ?? 0;
  return { x: leftOf(m, a.line) + a.dx * m.fontPx, y: top + a.dy * m.fontPx };
}

/** Skapar ett streck av punkter i px. */
export function strokeFromPx(m: LineMetrics, px: number[], color: InkColor, width: number, id: string): Stroke {
  const anchor = anchorAt(m, px[0], px[1]);
  const origin = anchorToPx(m, anchor);
  const points: number[] = [];
  for (let i = 0; i < px.length; i += 2) {
    points.push(round((px[i] - origin.x) / m.fontPx), round((px[i + 1] - origin.y) / m.fontPx));
  }
  return { id, anchor, points, color, width };
}

/** Streckets punkter i px relativt låten. */
export function strokeToPx(m: LineMetrics, s: Stroke): number[] {
  const o = anchorToPx(m, s.anchor);
  const out = new Array<number>(s.points.length);
  for (let i = 0; i < s.points.length; i += 2) {
    out[i] = o.x + s.points[i] * m.fontPx;
    out[i + 1] = o.y + s.points[i + 1] * m.fontPx;
  }
  return out;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Mjuk SVG-bana genom punkterna (kvadratiska kurvor via mittpunkter). */
export function smoothPath(p: number[]): string {
  if (p.length < 2) return '';
  if (p.length <= 4) {
    // En prick eller ett kort streck
    const x2 = p.length === 4 ? p[2] : p[0] + 0.01;
    const y2 = p.length === 4 ? p[3] : p[1];
    return `M${p[0]} ${p[1]}L${x2} ${y2}`;
  }
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length - 2; i += 2) {
    const mx = (p[i] + p[i + 2]) / 2;
    const my = (p[i + 1] + p[i + 3]) / 2;
    d += `Q${p[i]} ${p[i + 1]} ${mx} ${my}`;
  }
  d += `L${p[p.length - 2]} ${p[p.length - 1]}`;
  return d;
}

/** Sant om punkten (px) ligger nära strecket. */
export function hitStroke(px: number[], x: number, y: number, tolerance: number): boolean {
  const t2 = tolerance * tolerance;
  for (let i = 0; i < px.length; i += 2) {
    const ax = px[i];
    const ay = px[i + 1];
    const bx = i + 2 < px.length ? px[i + 2] : ax;
    const by = i + 3 < px.length ? px[i + 3] : ay;
    if (distToSegment2(x, y, ax, ay, bx, by) <= t2) return true;
  }
  return false;
}

function distToSegment2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Två lager ovanpå varandra (t.ex. låtens och setlistans egna). */
export function mergeAnnotations(a: Annotations | undefined, b: Annotations | undefined): Annotations | undefined {
  if (!hasAnnotations(b)) return a;
  if (!hasAnnotations(a)) return b;
  return { strokes: [...a!.strokes, ...b!.strokes], notes: [...a!.notes, ...b!.notes] };
}

export function hasAnnotations(a: Annotations | undefined): boolean {
  return !!a && (a.strokes.length > 0 || a.notes.length > 0);
}

/**
 * Lappens mittpunkt inom låtens bredd, så att lappen alltid syns och går att nå – även efter
 * att texten gjorts större eller iPaden vridits. Används både när lappen ritas och när den flyttas.
 */
export function clampNoteCenter(c: { x: number; y: number }, w: number, h: number, areaWidth: number): { x: number; y: number } {
  if (!(areaWidth > 0)) return c;
  const x = areaWidth > w ? Math.min(Math.max(c.x, w / 2), areaWidth - w / 2) : areaWidth / 2;
  return { x, y: Math.max(c.y, h / 2) };
}
