// Pekgester i anteckningsläget: rita, sudda, scrolla och hantera post-it-lappar.
//
// - Ett finger/penna ritar (Penna), suddar (Sudd), placerar en lapp (Lapp) eller scrollar (Flytta).
// - Två fingrar scrollar alltid. Har en Apple Pencil använts ritar bara pennan; fingret scrollar.
// - På en lapp: ett finger flyttar, två fingrar flyttar, snurrar gradlöst och ändrar storlek.
//   Handtagen på en vald lapp snurrar eller ändrar storlek med ett finger eller mus.

import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import {
  NOTE_LIMITS,
  anchorAt,
  anchorToPx,
  clamp,
  clampNoteCenter,
  hitStroke,
  strokeFromPx,
  strokeToPx,
  type Annotations,
  type InkColor,
  type LineMetrics,
  type StickyNote,
} from '../lib/annotations';
import { newId } from '../lib/model';
import type { LiveStroke } from '../components/AnnotationLayer';

export type AnnotTool = 'move' | 'pen' | 'eraser' | 'note';

interface Pointer {
  /** Klientkoordinater */
  cx: number;
  cy: number;
  type: string;
}

interface Geom {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
}

interface NoteGesture {
  id: string;
  handle?: 'rotate' | 'resize';
  base: Geom;
  /** Pekarnas startpositioner (låtkoordinater) per pointerId */
  start: Map<number, { x: number; y: number }>;
  handleAngle: number;
}

export interface GestureOptions {
  enabled: boolean;
  tool: AnnotTool;
  setTool: (t: AnnotTool) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  songRef: RefObject<HTMLDivElement | null>;
  metrics: LineMetrics | null;
  annotations: Annotations;
  inkColor: InkColor;
  inkWidth: number;
  /** commit = spara (och lägg i ångra-historiken); annars bara visa */
  update: (next: Annotations, commit: boolean) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  setLive: (s: LiveStroke | null) => void;
}

const TAP_DISTANCE = 8;
const TAP_TIME = 350;

export function useAnnotationGestures(options: GestureOptions) {
  const opt = useRef(options);
  opt.current = options;

  const st = useRef({
    pointers: new Map<number, Pointer>(),
    mode: 'idle' as 'idle' | 'draw' | 'erase' | 'pan' | 'place' | 'note',
    drawId: -1,
    stroke: [] as number[],
    penSeen: false,
    lastPan: { x: 0, y: 0 },
    note: null as NoteGesture | null,
    latest: null as Annotations | null,
    changed: false,
    tap: null as null | { x: number; y: number; t: number; noteId?: string; wasSelected?: boolean },
  });

  const current = () => st.current.latest ?? opt.current.annotations;

  const push = (next: Annotations, commit: boolean) => {
    st.current.latest = commit ? null : next;
    opt.current.update(next, commit);
  };

  const toSong = (cx: number, cy: number) => {
    const r = opt.current.songRef.current!.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  };

  const midClient = () => {
    let x = 0;
    let y = 0;
    const list = [...st.current.pointers.values()];
    for (const p of list) {
      x += p.cx;
      y += p.cy;
    }
    return { x: x / list.length, y: y / list.length };
  };

  const startPan = () => {
    const s = st.current;
    if (s.mode === 'draw') opt.current.setLive(null);
    // Suddning som övergår i scrollning: spara det som suddats
    if (s.mode === 'erase' && s.changed) push(current(), true);
    s.mode = 'pan';
    s.lastPan = midClient();
  };

  const geomOf = (n: StickyNote, m: LineMetrics): Geom => {
    const w = n.w * m.fontPx;
    const h = n.h * m.fontPx;
    // Samma plats som lappen ritas på (inom låtens bredd)
    const c = clampNoteCenter(anchorToPx(m, n.anchor), w, h, opt.current.songRef.current?.clientWidth ?? 0);
    return { cx: c.x, cy: c.y, w, h, rot: n.rotation };
  };

  const rebaseline = () => {
    const s = st.current;
    const m = opt.current.metrics;
    if (!s.note || !m) return;
    const n = current().notes.find((x) => x.id === s.note!.id);
    if (!n) return;
    s.note.base = geomOf(n, m);
    s.note.start = new Map();
    for (const [id, p] of s.pointers) s.note.start.set(id, toSong(p.cx, p.cy));
    const first = [...s.note.start.values()][0];
    if (first) s.note.handleAngle = Math.atan2(first.y - s.note.base.cy, first.x - s.note.base.cx);
  };

  const applyNote = () => {
    const s = st.current;
    const m = opt.current.metrics;
    const g = s.note;
    if (!g || !m) return;
    const ids = [...g.start.keys()].filter((id) => s.pointers.has(id));
    if (!ids.length) return;
    const now = ids.map((id) => {
      const p = s.pointers.get(id)!;
      return toSong(p.cx, p.cy);
    });
    const start = ids.map((id) => g.start.get(id)!);
    const b = g.base;
    let { cx, cy, w, h, rot } = b;

    if (g.handle && ids.length === 1) {
      const p = now[0];
      if (g.handle === 'rotate') {
        const ang = Math.atan2(p.y - b.cy, p.x - b.cx);
        rot = b.rot + ((ang - g.handleAngle) * 180) / Math.PI;
      } else {
        // Punkten i lappens egna (roterade) koordinater; storleksändring kring mittpunkten
        const a = (-b.rot * Math.PI) / 180;
        const dx = p.x - b.cx;
        const dy = p.y - b.cy;
        w = 2 * Math.abs(dx * Math.cos(a) - dy * Math.sin(a));
        h = 2 * Math.abs(dx * Math.sin(a) + dy * Math.cos(a));
      }
    } else if (ids.length >= 2) {
      const [a0, b0] = start;
      const [a1, b1] = now;
      const mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
      const mid1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
      const ang0 = Math.atan2(b0.y - a0.y, b0.x - a0.x);
      const ang1 = Math.atan2(b1.y - a1.y, b1.x - a1.x);
      const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
      const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
      cx = b.cx + (mid1.x - mid0.x);
      cy = b.cy + (mid1.y - mid0.y);
      rot = b.rot + ((ang1 - ang0) * 180) / Math.PI;
      w = b.w * (d1 / d0);
      h = b.h * (d1 / d0);
    } else {
      cx = b.cx + (now[0].x - start[0].x);
      cy = b.cy + (now[0].y - start[0].y);
    }

    const fp = m.fontPx;
    const next = current().notes.map((n) =>
      n.id === g.id
        ? {
            ...n,
            anchor: anchorAt(m, cx, cy),
            w: clamp(w / fp, NOTE_LIMITS.minW, NOTE_LIMITS.maxW),
            h: clamp(h / fp, NOTE_LIMITS.minH, NOTE_LIMITS.maxH),
            rotation: ((rot % 360) + 360) % 360,
          }
        : n,
    );
    s.changed = true;
    push({ ...current(), notes: next }, false);
  };

  const eraseAt = (x: number, y: number) => {
    const m = opt.current.metrics;
    if (!m) return;
    const ann = current();
    const tol = Math.max(14, m.fontPx * 0.6);
    const keep = ann.strokes.filter((s) => !hitStroke(strokeToPx(m, s), x, y, tol + (s.width * m.fontPx) / 2));
    if (keep.length !== ann.strokes.length) {
      st.current.changed = true;
      push({ ...ann, strokes: keep }, false);
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const o = opt.current;
    if (!o.enabled || !o.metrics || !o.songRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest('textarea')) return;
    const s = st.current;
    // Handflata eller finger på skärmen medan man ritar med pennan: ignorera, så att strecket
    // inte avbryts
    if (e.pointerType === 'touch' && s.mode === 'draw' && [...s.pointers.values()].some((p) => p.type === 'pen')) return;
    s.pointers.set(e.pointerId, { cx: e.clientX, cy: e.clientY, type: e.pointerType });
    if (e.pointerType === 'pen') s.penSeen = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Inte kritiskt
    }
    const p = toSong(e.clientX, e.clientY);

    // Fler fingrar på en lapp som redan hanteras: nyp/snurra
    if (s.mode === 'note') {
      rebaseline();
      return;
    }

    const noteEl = target.closest<HTMLElement>('[data-note-id]');
    if (noteEl && s.pointers.size === 1) {
      const id = noteEl.dataset.noteId!;
      const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle as NoteGesture['handle'];
      const wasSelected = o.selectedId === id;
      o.setSelectedId(id);
      if (o.editingId && o.editingId !== id) o.setEditingId(null);
      s.mode = 'note';
      s.changed = false;
      s.note = { id, handle, base: { cx: 0, cy: 0, w: 0, h: 0, rot: 0 }, start: new Map(), handleAngle: 0 };
      s.tap = { x: p.x, y: p.y, t: performance.now(), noteId: id, wasSelected };
      rebaseline();
      return;
    }

    // Två fingrar (eller fler) någonstans: scrolla
    if (s.pointers.size >= 2) {
      startPan();
      return;
    }

    if (o.editingId) o.setEditingId(null);
    if (o.selectedId) o.setSelectedId(null);

    const fingerWhilePen = e.pointerType === 'touch' && s.penSeen;
    if (fingerWhilePen || o.tool === 'move') {
      startPan();
      return;
    }
    s.changed = false;
    if (o.tool === 'pen') {
      s.mode = 'draw';
      s.drawId = e.pointerId;
      s.stroke = [p.x, p.y];
      o.setLive({ points: s.stroke, color: o.inkColor, width: o.inkWidth });
    } else if (o.tool === 'eraser') {
      s.mode = 'erase';
      eraseAt(p.x, p.y);
    } else if (o.tool === 'note') {
      s.mode = 'place';
      s.tap = { x: p.x, y: p.y, t: performance.now() };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = st.current;
    const ptr = s.pointers.get(e.pointerId);
    if (!ptr) return;
    ptr.cx = e.clientX;
    ptr.cy = e.clientY;
    const o = opt.current;
    switch (s.mode) {
      case 'draw': {
        if (e.pointerId !== s.drawId) return;
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
        for (const ev of events.length ? events : [e.nativeEvent]) {
          const p = toSong(ev.clientX, ev.clientY);
          const lx = s.stroke[s.stroke.length - 2];
          const ly = s.stroke[s.stroke.length - 1];
          if (Math.hypot(p.x - lx, p.y - ly) >= 1.5) s.stroke.push(p.x, p.y);
        }
        o.setLive({ points: [...s.stroke], color: o.inkColor, width: o.inkWidth });
        break;
      }
      case 'erase': {
        const p = toSong(e.clientX, e.clientY);
        eraseAt(p.x, p.y);
        break;
      }
      case 'pan': {
        const m = midClient();
        const el = o.scrollRef.current;
        if (el) el.scrollTop -= m.y - s.lastPan.y;
        s.lastPan = m;
        break;
      }
      case 'note':
        applyNote();
        break;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = st.current;
    if (!s.pointers.has(e.pointerId)) return;
    const o = opt.current;
    const m = o.metrics;
    const last = s.pointers.get(e.pointerId)!;
    s.pointers.delete(e.pointerId);
    const cancelled = e.type === 'pointercancel';

    switch (s.mode) {
      case 'draw':
        if (e.pointerId !== s.drawId) return;
        o.setLive(null);
        if (!cancelled && m && s.stroke.length >= 2) {
          const stroke = strokeFromPx(m, s.stroke, o.inkColor, o.inkWidth, newId());
          const ann = current();
          push({ ...ann, strokes: [...ann.strokes, stroke] }, true);
        }
        s.mode = 'idle';
        break;
      case 'erase':
        if (s.pointers.size === 0) {
          if (s.changed) push(current(), true);
          s.mode = 'idle';
        }
        break;
      case 'pan':
        if (s.pointers.size === 0) s.mode = 'idle';
        else s.lastPan = midClient();
        break;
      case 'place': {
        s.mode = 'idle';
        const p = toSong(last.cx, last.cy);
        if (cancelled || !m || !s.tap || Math.hypot(p.x - s.tap.x, p.y - s.tap.y) > TAP_DISTANCE) break;
        const note: StickyNote = {
          id: newId(),
          anchor: anchorAt(m, s.tap.x, s.tap.y),
          w: 8,
          h: 5,
          rotation: 0,
          text: '',
          fontSize: 0.8,
          color: 'yellow',
        };
        const ann = current();
        push({ ...ann, notes: [...ann.notes, note] }, true);
        o.setSelectedId(note.id);
        o.setEditingId(note.id);
        o.setTool('move');
        break;
      }
      case 'note':
        if (s.pointers.size > 0) {
          rebaseline();
          break;
        }
        {
          const p = toSong(last.cx, last.cy);
          const tap = s.tap;
          const isTap =
            tap && Math.hypot(p.x - tap.x, p.y - tap.y) <= TAP_DISTANCE && performance.now() - tap.t <= TAP_TIME;
          if (s.changed) push(current(), true);
          // Tryck på en redan vald lapp: börja skriva
          if (isTap && tap?.wasSelected && tap.noteId && !s.note?.handle) o.setEditingId(tap.noteId);
        }
        s.mode = 'idle';
        s.note = null;
        s.tap = null;
        break;
    }
  };

  /** Nollställer pågående gester, t.ex. när låten byts, vid ångra eller när man slutar anteckna. */
  const reset = () => {
    const s = st.current;
    s.mode = 'idle';
    s.pointers.clear();
    s.note = null;
    s.stroke = [];
    s.latest = null;
    s.changed = false;
    s.tap = null;
    opt.current.setLive(null);
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, reset };
}
