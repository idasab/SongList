// Export av en setlista: ren text, ChordPro eller PDF (med eller utan anteckningar).
//
// PDF:en byggs med riktig text (inte en skärmbild). Raderna numreras på samma sätt som i
// appens visning (data-ln), och avstånden räknas i em som i stilmallen. Därför hamnar
// post-it-lappar och handritade streck på samma rad som i appen.

import {
  capoOf,
  displayChordContext,
  isChordRow,
  parseChordPro,
  midWordBreaks,
  splitWords,
  songPrefersFlats,
  transposeSource,
  type Line,
  type ParsedSong,
  type Section,
} from '../lib/chordpro';
import { formatChord, formatKey, parseKey, type ChordContext, type Notation } from '../lib/chords';
import {
  NOTE_COLORS,
  anchorToPx,
  strokeToPx,
  type Annotations,
  type InkColor,
  type LineMetrics,
} from '../lib/annotations';
import type { Setlist, Song, SongAttachment } from '../lib/model';
import { safeFileName, saveBinaryFile, saveTextFile } from './files';
import { loadPdfJs } from './fileImport';
import { isCue, itemTitle, liveItems } from '../lib/setlist';

export type SetlistExportFormat = 'text' | 'pdf-annotated' | 'pdf-clean' | 'chordpro';

export const EXPORT_FORMATS: { value: SetlistExportFormat; label: string; description: string }[] = [
  { value: 'text', label: 'Texter', description: 'Sångtexterna utan ackord, i setlistans ordning (.txt)' },
  { value: 'pdf-annotated', label: 'PDF med anteckningar', description: 'Ackord ovanför texten, med lappar och det du ritat' },
  { value: 'pdf-clean', label: 'PDF utan anteckningar', description: 'Ackord ovanför texten, utan lappar och ritningar' },
  { value: 'chordpro', label: 'ChordPro', description: 'Alla låtar i en ChordPro-fil (.txt)' },
];

interface PreparedSong {
  song: Song;
  parsed: ParsedSong;
  ctx: ChordContext;
}

function prepare(setlist: Setlist, songs: Record<string, Song>, notation: Notation): PreparedSong[] {
  return setlist.items
    .filter((it) => !isCue(it))
    .map((it) => songs[it.songId])
    .filter((s): s is Song => !!s && !s.deletedAt)
    .map((song) => {
      const parsed = parseChordPro(song.content);
      // Ackorden exporteras som de visas: som grepp när låten har kapo
      return { song, parsed, ctx: displayChordContext(parsed, song.transpose, notation) };
    });
}

function keyLabel(p: PreparedSong): string {
  const k = parseKey(p.parsed.meta.key, { hNotation: p.parsed.hNotation });
  return k ? formatKey(k, p.song.transpose, p.ctx.notation) : '';
}

function infoLine(p: PreparedSong): string {
  const parts: string[] = [];
  const key = keyLabel(p);
  if (key) parts.push(`Tonart ${key}`);
  const capo = capoOf(p.parsed);
  if (capo > 0) {
    const k = parseKey(p.parsed.meta.key, { hNotation: p.parsed.hNotation });
    parts.push(`Kapo ${capo}` + (k ? ` (grepp i ${formatKey(k, p.song.transpose - capo, p.ctx.notation)})` : ''));
  }
  if (p.parsed.meta.tempo) parts.push(`Tempo ${p.parsed.meta.tempo}`);
  if (p.parsed.meta.time) parts.push(`Takt ${p.parsed.meta.time}`);
  return parts.join(' · ');
}

function formatDateSv(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fileBase(setlist: Setlist): string {
  return safeFileName(setlist.date ? `${setlist.name} ${setlist.date}` : setlist.name);
}

// --- Text ---

/** En låts text utan ackord. */
function songText(p: PreparedSong, number?: number): string {
  const out: string[] = [number ? `${number}. ${p.song.title}` : p.song.title];
  if (p.parsed.meta.subtitle) out.push(p.parsed.meta.subtitle);
  if (p.song.artist) out.push(p.song.artist);
  out.push('');
  if (p.song.attachment) {
    out.push(`(Bifogad fil: ${p.song.attachment.name})`);
    return tidy(out.join('\n'));
  }
  for (const sec of p.parsed.sections) {
    if (sec.label) out.push(sec.label.toUpperCase());
    for (const line of sec.lines) {
      if (line.type === 'lyrics') {
        // Rader med bara ackord och taktsymboler är inte sångtext
        if (isChordRow(line.segments)) continue;
        const text = line.segments.map((s) => s.text).join('').replace(/\s+$/, '');
        if (text.trim()) out.push(text);
      } else if (line.type === 'comment') {
        out.push(`(${line.text})`);
      } else if (line.type === 'pre') {
        out.push(line.text);
      } else {
        out.push('');
      }
    }
    out.push('');
  }
  return tidy(out.join('\n'));
}

function tidy(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

type OverviewRow = { kind: 'song'; p: PreparedSong; number: number } | { kind: 'cue'; text: string };

/** Setlistans ordning: numrerade låtar och mellanpunkter (t.ex. "Tal") där de står. */
function overviewRows(setlist: Setlist, songs: Record<string, Song>, list: PreparedSong[]): OverviewRow[] {
  const rows: OverviewRow[] = [];
  let n = 0;
  for (const it of liveItems(setlist.items, songs)) {
    if (isCue(it)) rows.push({ kind: 'cue', text: itemTitle(it, songs) });
    else if (list[n]) {
      rows.push({ kind: 'song', p: list[n], number: n + 1 });
      n++;
    }
  }
  return rows;
}

/** Setlistans namn, datum, anteckningar och numrerade låtar med artist. */
function setlistOverview(setlist: Setlist, songs: Record<string, Song>, list: PreparedSong[]): string[] {
  const out: string[] = [setlist.name];
  if (setlist.date) out.push(formatDateSv(setlist.date));
  if (setlist.notes) out.push('', setlist.notes);
  out.push('');
  for (const r of overviewRows(setlist, songs, list)) {
    if (r.kind === 'cue') out.push(`   – ${r.text} –`);
    else out.push(`${r.number}. ${r.p.song.title}${r.p.song.artist ? ' – ' + r.p.song.artist : ''}`);
  }
  return out;
}

export function buildTextExport(setlist: Setlist, songs: Record<string, Song>, notation: Notation): string {
  const list = prepare(setlist, songs, notation);
  const out = setlistOverview(setlist, songs, list);
  list.forEach((p, i) => out.push('', '', '='.repeat(40), '', songText(p, i + 1)));
  return tidy(out.join('\n'));
}

// --- ChordPro ---

/** En låts ChordPro-källa med transponeringen inskriven. */
function songChordPro(p: PreparedSong): string {
  if (p.song.attachment) return `${p.song.content.trim()}\n{comment: Bifogad fil: ${p.song.attachment.name}}\n`;
  const src = p.song.transpose
    ? transposeSource(p.song.content, {
        transpose: p.song.transpose,
        // ChordPro-filen behåller ackorden som de klingar, med {capo} kvar
        preferFlats: songPrefersFlats(p.parsed, p.song.transpose),
        notation: p.parsed.hNotation ? 'swedish' : 'international',
      })
    : p.song.content;
  return src.trim() + '\n';
}

export function buildChordProExport(setlist: Setlist, songs: Record<string, Song>, notation: Notation): string {
  const list = prepare(setlist, songs, notation);
  const header = [`# Setlista: ${setlist.name}`];
  if (setlist.date) header.push(`# Datum: ${setlist.date}`);
  return header.join('\n') + '\n\n' + list.map((p) => songChordPro(p).trim()).join('\n\n{new_song}\n\n') + '\n';
}

// --- PDF ---

const PAGE_W = 595.28; // A4 i punkter
const PAGE_H = 841.89;
const MARGIN_X = 46;
const MARGIN_TOP = 50;
const MARGIN_BOTTOM = 56;
/** Låttextens storlek i punkter (motsvarar 1 em i appen) */
const EM = 12;

// Radhöjder i em, enligt stilmallen för låtvisningen
const M = {
  chordGap: 0.45,
  chordRow: 0.9,
  lyricRow: 1.25,
  plain: 1.4,
  label: 1.05,
  commentGap: 0.3,
  comment: 1.2,
  empty: 0.7,
  pre: 1.04,
  sectionGap: 1.7,
  /** Luft ovanför en ackordrad direkt under en rubrik */
  chordGapAfterLabel: 0.1,
  chorusIndent: 0.95,
};

const INK_PDF: Record<InkColor, string> = {
  ink: '#1b1d22',
  red: '#c62828',
  blue: '#2f6fdf',
  green: '#458268',
};

const TEXT = '#1b1d22';
const MUTED = '#6b6f78';
const ACCENT = '#68af90';

type JsPdf = import('jspdf').jsPDF;

interface PdfCtx {
  doc: JsPdf;
  /** Aktuell sida (1-baserad) och y-position */
  page: number;
  y: number;
}

const CONTENT_BOTTOM = PAGE_H - MARGIN_BOTTOM;

/** Virtuell y-koordinat: sidindex * sidhöjd + y på sidan (används för anteckningarnas ankare). */
function virtualY(c: PdfCtx, y = c.y): number {
  return (c.page - 1) * PAGE_H + y;
}

function ensureSpace(c: PdfCtx, h: number) {
  if (c.y + h > CONTENT_BOTTOM) {
    c.doc.addPage();
    c.page = c.doc.getNumberOfPages();
    c.y = MARGIN_TOP;
  }
}

function setFont(doc: JsPdf, style: 'normal' | 'bold' | 'italic', size: number, color = TEXT) {
  doc.setFont('helvetica', style);
  doc.setFontSize(size);
  doc.setTextColor(color);
}

function drawLine(
  c: PdfCtx,
  line: Line,
  x0: number,
  maxX: number,
  ctx: ChordContext,
  tops: number[],
  ln: number,
  afterLabel = false,
) {
  const chordGap = (afterLabel ? M.chordGapAfterLabel : M.chordGap) * EM;
  const doc = c.doc;
  switch (line.type) {
    case 'empty':
      ensureSpace(c, M.empty * EM);
      tops[ln] = virtualY(c);
      c.y += M.empty * EM;
      return;
    case 'comment': {
      c.y += M.commentGap * EM;
      ensureSpace(c, M.comment * EM);
      tops[ln] = virtualY(c);
      setFont(doc, line.style === 'italic' ? 'italic' : 'bold', 0.85 * EM, MUTED);
      const rows = doc.splitTextToSize(line.text, maxX - x0) as string[];
      rows.forEach((r, i) => doc.text(r, x0, c.y + i * 0.85 * EM * 1.3, { baseline: 'top' }));
      c.y += Math.max(M.comment, rows.length * 0.85 * 1.3) * EM + M.commentGap * EM;
      return;
    }
    case 'pre': {
      ensureSpace(c, M.pre * EM);
      tops[ln] = virtualY(c);
      doc.setFont('courier', 'normal');
      doc.setFontSize(0.8 * EM);
      doc.setTextColor(TEXT);
      doc.text(line.text || ' ', x0, c.y, { baseline: 'top' });
      c.y += M.pre * EM;
      return;
    }
    case 'lyrics': {
      const hasChord = line.segments.some((s) => s.chord !== undefined);
      if (!hasChord) {
        const text = line.segments.map((s) => s.text).join('');
        setFont(doc, 'normal', EM);
        const rows = text.trim() ? (doc.splitTextToSize(text, maxX - x0) as string[]) : [' '];
        rows.forEach((r, i) => {
          ensureSpace(c, M.plain * EM);
          if (i === 0) tops[ln] = virtualY(c);
          doc.text(r, x0, c.y + 0.08 * EM, { baseline: 'top' });
          c.y += M.plain * EM;
        });
        return;
      }
      if (isChordRow(line.segments)) {
        // Ackord och taktsymboler på en rad
        c.y += chordGap;
        ensureSpace(c, M.plain * EM);
        tops[ln] = virtualY(c);
        let x = x0;
        for (const s of line.segments) {
          if (s.chord !== undefined) {
            const annot = s.chord.startsWith('*');
            const chord = formatChord(s.chord, ctx);
            setFont(doc, annot ? 'italic' : 'bold', 0.85 * EM, annot ? MUTED : TEXT);
            if (x + doc.getTextWidth(chord) > maxX && x > x0) {
              x = x0;
              c.y += M.plain * EM;
              ensureSpace(c, M.plain * EM);
            }
            doc.text(chord, x, c.y, { baseline: 'top' });
            x += doc.getTextWidth(chord);
          }
          if (s.text) {
            setFont(doc, 'normal', 0.85 * EM, MUTED);
            doc.text(s.text, x, c.y, { baseline: 'top' });
            x += doc.getTextWidth(s.text);
          }
        }
        c.y += M.plain * EM;
        return;
      }
      const lyricsEmpty = line.segments.every((s) => !s.text.trim());
      const rowH = (M.chordRow + (lyricsEmpty ? 0 : M.lyricRow)) * EM;
      const split = splitWords(line.segments);
      const breaks = midWordBreaks(split);
      const segs = split.map((s) => {
        const chord = s.chord !== undefined ? formatChord(s.chord, ctx) : '';
        setFont(doc, 'bold', 0.85 * EM);
        const cw = chord ? doc.getTextWidth(chord) + 0.35 * 0.85 * EM : 0;
        setFont(doc, 'normal', EM);
        const lw = lyricsEmpty ? 0 : doc.getTextWidth(s.text);
        return { chord, text: s.text, annot: !!s.chord?.startsWith('*'), w: Math.max(cw, lw), lw };
      });
      c.y += chordGap;
      let first = true;
      let i = 0;
      while (i < segs.length) {
        ensureSpace(c, rowH);
        if (first) tops[ln] = virtualY(c);
        first = false;
        let x = x0;
        const start = i;
        while (i < segs.length && (i === start || x + segs[i].w <= maxX)) {
          const s = segs[i];
          if (s.chord) {
            setFont(doc, s.annot ? 'italic' : 'bold', 0.85 * EM, s.annot ? MUTED : TEXT);
            doc.text(s.chord, x, c.y, { baseline: 'top' });
          }
          if (!lyricsEmpty && s.text) {
            setFont(doc, 'normal', EM);
            doc.text(s.text, x, c.y + M.chordRow * EM + 0.05 * EM, { baseline: 'top' });
            // Bindestreck i mellanrummet när ackordet gör ordet bredare
            const dash = doc.getTextWidth('-');
            const gap = s.w - s.lw;
            if (breaks[i] && gap >= dash + 0.3 * EM) {
              doc.text('-', x + s.lw + (gap - dash) / 2, c.y + M.chordRow * EM + 0.05 * EM, { baseline: 'top' });
            }
          }
          x += s.w;
          i++;
        }
        c.y += rowH;
      }
      return;
    }
  }
}

function drawSection(c: PdfCtx, sec: Section, start: number, ctx: ChordContext, tops: number[]) {
  const doc = c.doc;
  const indent = sec.type === 'chorus' ? M.chorusIndent * EM : 0;
  const x0 = MARGIN_X + indent;
  const maxX = PAGE_W - MARGIN_X;
  const barTop = { page: c.page, y: c.y };
  let ln = start;
  if (sec.label) {
    ensureSpace(c, M.label * EM + M.plain * EM);
    tops[ln] = virtualY(c);
    setFont(doc, 'bold', 0.75 * EM, MUTED);
    doc.text(sec.label.toUpperCase() + (sec.isRepeat ? '  (upprepning)' : ''), x0, c.y, { baseline: 'top' });
    c.y += M.label * EM;
    ln++;
    if (barTop.page !== c.page) {
      barTop.page = c.page;
      barTop.y = c.y - M.label * EM;
    }
  }
  let first = true;
  for (const line of sec.lines) {
    const pageBefore = c.page;
    drawLine(c, line, x0, maxX, ctx, tops, ln++, first && !!sec.label);
    first = false;
    // Refrängens linje: rita fram till sidbytet och börja om på nästa sida
    if (indent && c.page !== pageBefore) {
      drawBar(doc, pageBefore, barTop.y, CONTENT_BOTTOM);
      barTop.page = c.page;
      barTop.y = MARGIN_TOP;
    }
  }
  if (indent) drawBar(doc, c.page, barTop.page === c.page ? barTop.y : MARGIN_TOP, c.y);
  c.y += M.sectionGap * EM;
}

function drawBar(doc: JsPdf, page: number, y1: number, y2: number) {
  if (y2 <= y1) return;
  const current = doc.getCurrentPageInfo().pageNumber;
  doc.setPage(page);
  doc.setFillColor(ACCENT);
  doc.rect(MARGIN_X, y1, 2.2, y2 - y1, 'F');
  doc.setPage(current);
}

function drawSongHeader(c: PdfCtx, p: PreparedSong, index: number, tops: number[]) {
  const doc = c.doc;
  tops[0] = virtualY(c);
  setFont(doc, 'bold', 1.5 * EM);
  const title = doc.splitTextToSize(`${index}. ${p.song.title}`, PAGE_W - 2 * MARGIN_X) as string[];
  title.forEach((t, i) => doc.text(t, MARGIN_X, c.y + i * 1.5 * EM * 1.2, { baseline: 'top' }));
  c.y += title.length * 1.5 * EM * 1.2;
  if (p.parsed.meta.subtitle) {
    setFont(doc, 'italic', EM, MUTED);
    doc.text(p.parsed.meta.subtitle, MARGIN_X, c.y + 2, { baseline: 'top' });
    c.y += 1.4 * EM + 2;
  }
  if (p.song.artist) {
    setFont(doc, 'normal', EM, MUTED);
    doc.text(p.song.artist, MARGIN_X, c.y + 2, { baseline: 'top' });
    c.y += 1.4 * EM + 2;
  }
  const info = infoLine(p);
  if (info) {
    setFont(doc, 'normal', 0.8 * EM, MUTED);
    doc.text(info, MARGIN_X, c.y + 0.4 * EM, { baseline: 'top' });
    c.y += 0.4 * EM + 1.12 * EM;
  }
  c.y += 1.1 * EM;
}

function drawAnnotations(doc: JsPdf, ann: Annotations, tops: number[]) {
  // Ankarnas x räknas från låtens vänsterkant, y från radens överkant (virtuella koordinater)
  const metrics: LineMetrics = { tops, fontPx: EM };
  const toPage = (vy: number) => {
    const page = Math.floor(vy / PAGE_H) + 1;
    return { page, y: vy - (page - 1) * PAGE_H };
  };
  const current = doc.getCurrentPageInfo().pageNumber;

  for (const s of ann.strokes) {
    const px = strokeToPx(metrics, s);
    if (px.length < 2) continue;
    const anchorTop = tops[Math.min(s.anchor.line, tops.length - 1)] ?? 0;
    const { page } = toPage(anchorTop);
    const offset = (page - 1) * PAGE_H;
    doc.setPage(page);
    doc.setDrawColor(INK_PDF[s.color]);
    doc.setLineWidth(Math.max(0.4, s.width * EM));
    doc.setLineCap('round');
    doc.setLineJoin('round');
    const x0 = MARGIN_X + px[0];
    const y0 = px[1] - offset;
    if (px.length <= 2) {
      doc.line(x0, y0, x0 + 0.01, y0);
      continue;
    }
    const segs: [number, number][] = [];
    for (let i = 2; i < px.length; i += 2) segs.push([px[i] - px[i - 2], px[i + 1] - px[i - 1]]);
    doc.lines(segs, x0, y0, [1, 1], 'S', false);
  }

  for (const n of ann.notes) {
    const c = anchorToPx(metrics, n.anchor);
    const anchorTop = tops[Math.min(n.anchor.line, tops.length - 1)] ?? 0;
    const { page } = toPage(anchorTop);
    const cx = MARGIN_X + c.x;
    const cy = c.y - (page - 1) * PAGE_H;
    const w = n.w * EM;
    const h = n.h * EM;
    // PDF:ens y-axel pekar nedåt här, precis som på skärmen: positiv vinkel = medurs
    const a = (n.rotation * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const rot = (x: number, y: number) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos });
    const corners = [rot(-w / 2, -h / 2), rot(w / 2, -h / 2), rot(w / 2, h / 2), rot(-w / 2, h / 2)];
    doc.setPage(page);
    doc.setFillColor(NOTE_COLORS[n.color]);
    doc.setDrawColor('#d8cf9a');
    doc.setLineWidth(0.5);
    doc.lines(
      corners.slice(1).map((p, i) => [p.x - corners[i].x, p.y - corners[i].y] as [number, number]),
      corners[0].x,
      corners[0].y,
      [1, 1],
      'FD',
      true,
    );
    if (n.text.trim()) {
      const size = n.fontSize * EM;
      const pad = { x: 0.55 * EM, y: 0.45 * EM };
      setFont(doc, 'normal', size, '#2a2a2a');
      const rows = (doc.splitTextToSize(n.text, Math.max(10, w - 2 * pad.x)) as string[]).slice(
        0,
        Math.max(1, Math.floor((h - 2 * pad.y) / (size * 1.25))),
      );
      rows.forEach((r, i) => {
        const o = rot(-w / 2 + pad.x, -h / 2 + pad.y + i * size * 1.25 + size * 0.85);
        doc.text(r, o.x, o.y, { angle: -n.rotation });
      });
    }
  }
  doc.setPage(current);
}

function drawCover(c: PdfCtx, setlist: Setlist, rows: OverviewRow[]) {
  const doc = c.doc;
  setFont(doc, 'bold', 24);
  doc.text(setlist.name, MARGIN_X, c.y, { baseline: 'top' });
  c.y += 32;
  if (setlist.date) {
    setFont(doc, 'normal', 12, MUTED);
    doc.text(formatDateSv(setlist.date), MARGIN_X, c.y, { baseline: 'top' });
    c.y += 20;
  }
  if (setlist.notes) {
    setFont(doc, 'normal', 11, TEXT);
    const rows = doc.splitTextToSize(setlist.notes, PAGE_W - 2 * MARGIN_X) as string[];
    rows.forEach((r) => {
      doc.text(r, MARGIN_X, c.y, { baseline: 'top' });
      c.y += 15;
    });
  }
  c.y += 18;
  rows.forEach((r) => {
    ensureSpace(c, 22);
    if (r.kind === 'cue') {
      setFont(doc, 'italic', 12, MUTED);
      doc.text(r.text, MARGIN_X + 26, c.y, { baseline: 'top' });
      c.y += 22;
      return;
    }
    const p = r.p;
    setFont(doc, 'bold', 12);
    doc.text(`${r.number}.`, MARGIN_X, c.y, { baseline: 'top' });
    doc.text(p.song.title, MARGIN_X + 26, c.y, { baseline: 'top' });
    const key = keyLabel(p);
    if (key) doc.text(key, PAGE_W - MARGIN_X, c.y, { baseline: 'top', align: 'right' });
    if (p.song.artist) {
      const tw = doc.getTextWidth(p.song.title);
      setFont(doc, 'normal', 12, MUTED);
      doc.text(`  ${p.song.artist}`, MARGIN_X + 26 + tw, c.y, { baseline: 'top' });
    }
    c.y += 22;
  });
}

function drawFooters(doc: JsPdf, footer: string) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    setFont(doc, 'normal', 8, MUTED);
    doc.text(footer, MARGIN_X, PAGE_H - 28);
    doc.text(`${i} / ${total}`, PAGE_W - MARGIN_X, PAGE_H - 28, { align: 'right' });
  }
}

/** Ritar in en bifogad bild eller PDF (som bilder av sidorna) i exporten. */
async function drawAttachment(c: PdfCtx, a: SongAttachment) {
  const images: { data: string; w: number; h: number }[] = [];
  if (a.kind === 'image') {
    const size = await imageSize(a.dataUrl);
    images.push({ data: await toJpeg(a.dataUrl, size), w: size.w, h: size.h });
  } else {
    const pdfjs = await loadPdfJs();
    const task = pdfjs.getDocument({ data: new Uint8Array(await (await fetch(a.dataUrl)).arrayBuffer()) });
    try {
      const pdf = await task.promise;
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 1600 / base.width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        images.push({ data: canvas.toDataURL('image/jpeg', 0.85), w: canvas.width, h: canvas.height });
      }
    } finally {
      void task.destroy();
    }
  }
  const maxW = PAGE_W - 2 * MARGIN_X;
  images.forEach((img, i) => {
    if (i > 0) {
      c.doc.addPage();
      c.page = c.doc.getNumberOfPages();
      c.y = MARGIN_TOP;
    }
    // Skala så att bilden ryms på resten av sidan
    const available = CONTENT_BOTTOM - c.y;
    const scale = Math.min(maxW / img.w, available / img.h);
    c.doc.addImage(img.data, 'JPEG', MARGIN_X, c.y, img.w * scale, img.h * scale);
    c.y += img.h * scale;
  });
}

function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = reject;
    im.src = dataUrl;
  });
}

/** jsPDF klarar JPEG och PNG; andra bildformat ritas om till JPEG. */
async function toJpeg(dataUrl: string, size: { w: number; h: number }): Promise<string> {
  if (dataUrl.startsWith('data:image/jpeg')) return dataUrl;
  const im = new Image();
  im.src = dataUrl;
  await im.decode();
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size.w, size.h);
  ctx.drawImage(im, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.9);
}

async function renderPdf(
  entries: { p: PreparedSong; number: number }[],
  opts: { title: string; footer: string; cover?: { setlist: Setlist; rows: OverviewRow[] }; withAnnotations: boolean },
): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setProperties({ title: opts.title, creator: 'SongList' });
  const c: PdfCtx = { doc, page: 1, y: MARGIN_TOP };

  if (opts.cover) drawCover(c, opts.cover.setlist, opts.cover.rows);

  for (let idx = 0; idx < entries.length; idx++) {
    const { p, number } = entries[idx];
    if (opts.cover || idx > 0) {
      doc.addPage();
      c.page = doc.getNumberOfPages();
      c.y = MARGIN_TOP;
    }
    const tops: number[] = [];
    drawSongHeader(c, p, number, tops);
    if (p.song.attachment) {
      await drawAttachment(c, p.song.attachment);
      continue;
    }
    let n = 1;
    for (const sec of p.parsed.sections) {
      drawSection(c, sec, n, p.ctx, tops);
      n += (sec.label ? 1 : 0) + sec.lines.length;
    }
    for (let i = 0; i < tops.length; i++) if (tops[i] === undefined) tops[i] = i ? tops[i - 1] : 0;
    if (opts.withAnnotations && p.song.annotations) drawAnnotations(doc, p.song.annotations, tops);
  }

  drawFooters(doc, opts.footer);
  return doc.output('blob');
}

export async function buildPdfExport(
  setlist: Setlist,
  songs: Record<string, Song>,
  notation: Notation,
  withAnnotations: boolean,
): Promise<Blob> {
  const list = prepare(setlist, songs, notation);
  return renderPdf(
    list.map((p, i) => ({ p, number: i + 1 })),
    { title: setlist.name, footer: setlist.name, cover: { setlist, rows: overviewRows(setlist, songs, list) }, withAnnotations },
  );
}

// --- En fil per låt (för e-post) ---

export interface ExportFile {
  name: string;
  mime: string;
  blob: Blob;
}

export async function buildSongFiles(
  format: SetlistExportFormat,
  setlist: Setlist,
  songs: Record<string, Song>,
  notation: Notation,
): Promise<ExportFile[]> {
  const list = prepare(setlist, songs, notation);
  const width = String(list.length).length < 2 ? 2 : String(list.length).length;
  const files: ExportFile[] = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const base = `${String(i + 1).padStart(width, '0')} ${safeFileName(p.song.title)}`;
    if (p.song.attachment) {
      // Låtar som sparats som fil (t.ex. noter) bifogas som originalfilen
      const a = p.song.attachment;
      const ext = /\.[^.]+$/.exec(a.name)?.[0] ?? (a.kind === 'pdf' ? '.pdf' : '.jpg');
      files.push({ name: `${base}${ext}`, mime: a.mime, blob: await (await fetch(a.dataUrl)).blob() });
      continue;
    }
    if (format === 'text') {
      files.push({ name: `${base}.txt`, mime: 'text/plain', blob: textBlob(songText(p)) });
    } else if (format === 'chordpro') {
      files.push({ name: `${base}.txt`, mime: 'text/plain', blob: textBlob(songChordPro(p)) });
    } else {
      const blob = await renderPdf([{ p, number: i + 1 }], {
        title: p.song.title,
        footer: `${setlist.name} · ${p.song.title}`,
        withAnnotations: format === 'pdf-annotated',
      });
      files.push({ name: `${base}.pdf`, mime: 'application/pdf', blob });
    }
  }
  return files;
}

function textBlob(text: string): Blob {
  return new Blob([text], { type: 'text/plain;charset=utf-8' });
}

/** Mejlets ämne är setlistans namn. */
export function mailSubject(setlist: Setlist): string {
  return setlist.name;
}

/** Mejlets text: hela setlistan med titel och artist. */
export function mailBody(setlist: Setlist, songs: Record<string, Song>, notation: Notation): string {
  const list = prepare(setlist, songs, notation);
  const out = setlistOverview(setlist, songs, list);
  out.push('', 'Varje låt finns bifogad som en egen fil.', '', 'Skickat från SongList');
  return out.join('\n');
}

// --- Spara ---

export async function exportSetlist(
  format: SetlistExportFormat,
  setlist: Setlist,
  songs: Record<string, Song>,
  notation: Notation,
): Promise<void> {
  const base = fileBase(setlist);
  switch (format) {
    case 'text':
      return saveTextFile(`${base}.txt`, buildTextExport(setlist, songs, notation));
    case 'chordpro':
      return saveTextFile(`${base} (ChordPro).txt`, buildChordProExport(setlist, songs, notation));
    case 'pdf-annotated':
    case 'pdf-clean': {
      const blob = await buildPdfExport(setlist, songs, notation, format === 'pdf-annotated');
      return saveBinaryFile(`${base}.pdf`, blob, 'application/pdf');
    }
  }
}
