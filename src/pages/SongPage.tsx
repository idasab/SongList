import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Download,
  FilePlus,
  Files,
  FileText,
  Image as ImageIcon,
  Eye,
  EyeOff,
  Guitar,
  History,
  ListMusic,
  Minus,
  Moon,
  Metronome as MetronomeIcon,
  MoreHorizontal,
  PenLine,
  Pause,
  Pencil,
  StickyNote as NoteIcon,
  StickyNoteOff as NoteOffIcon,
  Play,
  Plus,
  Trash,
  Wand2,
  X,
} from 'lucide-react';
import { AnnotationLayer, useLineMetrics, type LiveStroke } from '../components/AnnotationLayer';
import { AnnotationToolbar } from '../components/AnnotationToolbar';
import { ChordDiagram, ChordSheet } from '../components/ChordDiagram';
import { SongRenderer } from '../components/SongRenderer';
import { Header, Sheet, toast, toastError } from '../components/ui';
import { formatChord, formatKey, normalizeTranspose } from '../lib/chords';
import { filterSongs, songKey, sortSongs } from '../lib/search';
import {
  capoOf,
  capoShapeShift,
  displayChordContext,
  formatDuration,
  parseChordPro,
  parseDuration,
  shapesToSounding,
  songPrefersFlats,
  transposeSource,
  upsertDirective,
} from '../lib/chordpro';
import { liveSetlists, liveSongs, useStore } from '../store/useStore';
import { mergeSongs } from '../services/mergeSongs';
import { safeFileName, saveTextFile } from '../services/files';
import { newId, songFiles, type Song, type SongAttachment } from '../lib/model';
import { Metronome, beatsPerBar, parseTempo } from '../lib/metronome';
import { useWakeLock } from '../hooks/useWakeLock';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useSwipeNavigation } from '../hooks/useSwipeNavigation';
import { AttachmentView, NO_ZOOM, useFilePages, type PageZoom } from '../components/AttachmentView';
import { fileToAttachment } from '../services/fileImport';
import { isCue, itemPath, itemTitle, itemTranspose, liveItems, songCount, withItemCapo } from '../lib/setlist';
import { useAnnotationGestures, type AnnotTool } from '../hooks/useAnnotationGestures';
import { EMPTY_ANNOTATIONS, INK_WIDTHS, hasAnnotations, mergeAnnotations, type Annotations, type InkColor, type StickyNote } from '../lib/annotations';
import { lastPlayed, songHistory, todayIso } from '../lib/history';
import { askSubtitleArtist, subtitleToArtist } from '../lib/subtitleArtist';
import { formatDate } from './SetlistsPage';

const MIN_FONT = 12;
const MAX_FONT = 44;
/** Minsta textstorlek när texten krymps för att låten ska rymmas i två spalter */
const FIT_MIN_FONT = 14;

function scrollPxPerSecond(level: number): number {
  return 4 + level * level * 1.2;
}

export function SongPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const song = useStore((s) => s.songs[id]);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const updateSongPrefs = useStore((s) => s.updateSongPrefs);
  const saveSong = useStore((s) => s.saveSong);
  const saveSetlist = useStore((s) => s.saveSetlist);
  const deleteSong = useStore((s) => s.deleteSong);
  const setlist = useStore((s) => (params.get('setlist') ? s.setlists[params.get('setlist')!] : undefined));
  const songs = useStore((s) => s.songs);

  const [stage, setStage] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const [showChords, setShowChords] = useState(true);
  const [scrolling, setScrolling] = useState(false);
  const [chordSheet, setChordSheet] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [addToSetlist, setAddToSetlist] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const songRef = useRef<HTMLDivElement>(null);

  // Anteckningar
  const [annotating, setAnnotating] = useState(false);
  const [tool, setTool] = useState<AnnotTool>('pen');
  const [inkColor, setInkColor] = useState<InkColor>('red');
  const [inkWidth, setInkWidth] = useState(INK_WIDTHS[1]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [live, setLive] = useState<LiveStroke | null>(null);
  /** Lokal version medan en gest pågår; sparas när gesten är klar */
  const [draft, setDraft] = useState<Annotations | null>(null);
  const history = useRef<Annotations[]>([]);

  useWakeLock(true);

  const songParsed = useMemo(() => parseChordPro(song?.content ?? ''), [song?.content]);
  // Position i setlistan
  const setlistIndex = setlist ? Number(params.get('i') ?? 0) : -1;
  const setlistItems = useMemo(
    () => (setlist ? liveItems(setlist.items, songs) : []),
    [setlist, songs],
  );
  // Låten som punkt i setlistan: kan ha en egen tonart där
  // (har setlistan ändrats på en annan enhet så att platsen inte stämmer: låtens första förekomst)
  const setlistItem =
    setlistItems[setlistIndex]?.songId === id ? setlistItems[setlistIndex] : setlistItems.find((it) => it.songId === id);
  const transpose = song ? itemTranspose(setlistItem, song) : 0;
  // Låten som den visas: med setlistans eget kapo, om det finns
  const itemCapo = setlistItem?.capo;
  const parsed = useMemo(() => withItemCapo(songParsed, itemCapo === undefined ? undefined : { id: '', songId: '', capo: itemCapo }), [songParsed, itemCapo]);

  // Historik: när låten lämnas i en setlista sparas en kopia av dess anteckningar i setlistan,
  // så att man senare kan se hur de såg ut den gången
  const snapshotRef = useRef({ setlistId: '', itemId: '', annotations: undefined as Annotations | undefined });
  // Uppdateras efter renderingen: när låten byts har referensen kvar den förra låtens värden
  // när kopian sparas nedan
  useEffect(() => {
    snapshotRef.current = {
      setlistId: setlist?.id ?? '',
      itemId: setlistItem?.id ?? '',
      annotations: mergeAnnotations(song?.annotations, setlistItem?.ownAnnotations),
    };
  });
  useEffect(() => {
    const save = () => {
      const { setlistId, itemId, annotations: a } = snapshotRef.current;
      const sl = setlistId ? useStore.getState().setlists[setlistId] : undefined;
      const it = sl?.items.find((x) => x.id === itemId);
      if (!sl || !it) return;
      // En setlista vars datum har varit är historik: att titta på den igen ska inte skriva över kopian
      if (sl.date && sl.date < todayIso()) return;
      const next = hasAnnotations(a) ? a : undefined;
      if (JSON.stringify(next) === JSON.stringify(it.annotations)) return;
      void useStore.getState().saveSetlist({ ...sl, items: sl.items.map((x) => (x.id === itemId ? { ...x, annotations: next, playedAt: Date.now() } : x)) });
    };
    return save;
  }, [setlistItem?.id, setlist?.id]);
  const [showHistory, setShowHistory] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  /** Anteckningar från ett tidigare tillfälle som visas i stället för de nuvarande */
  const [pastNotes, setPastNotes] = useState<{ annotations: Annotations; label: string } | null>(null);
  useEffect(() => setPastNotes(null), [id]);

  // Nästa punkt i setlistan: visas sist i låten (titel, tonart och de första ackorden)
  const nextItem = setlist ? setlistItems[setlistIndex + 1] : undefined;
  const nextUp = useMemo(() => {
    if (!nextItem) return null;
    const next = songs[nextItem.songId];
    if (isCue(nextItem) || !next) return { title: itemTitle(nextItem, songs) };
    const t = itemTranspose(nextItem, next);
    const k = next.attachment ? null : songKey(next, t);
    const p = withItemCapo(parseChordPro(next.content), nextItem);
    const c = displayChordContext(p, t, settings.notation, settings.simplifyChords);
    const chords = [...new Set(p.chords.filter((ch) => !ch.startsWith('*')).map((ch) => formatChord(ch, c)))].slice(0, 5);
    return {
      title: next.title,
      key: k ? formatKey(k.key, 0, settings.notation) : undefined,
      capo: capoOf(p) || undefined,
      chords,
    };
  }, [nextItem, songs, settings.notation, settings.simplifyChords]);
  const preferFlats = songPrefersFlats(parsed, transpose);
  // Med {duration} och utan egen hastighet: scrolla genom hela låten på den tiden
  const duration = song?.scrollSpeed === undefined ? parseDuration(parsed.meta.duration) : undefined;
  const speed = song?.scrollSpeed ?? 3;

  // Anteckningar i två lager: låtens egna (syns överallt) och setlistans egna (syns bara i
  // setlistan, ovanpå låtens). Med "I setlistan" ritar och suddar man i setlistans lager.
  const scopeSetlist = !!setlistItem && settings.transposeScope !== 'global';
  const layer: 'song' | 'setlist' = scopeSetlist ? 'setlist' : 'song';
  const saved = (layer === 'setlist' ? setlistItem?.ownAnnotations : song?.annotations) ?? EMPTY_ANNOTATIONS;
  const otherLayer = layer === 'setlist' ? song?.annotations : setlistItem?.ownAnnotations;
  const annotations = draft ?? saved;
  // Låtar som sparats som filer: alla sidor i tur och ordning, en i taget i sidled (förval)
  // Bara när filerna ändras (inte vid t.ex. transponering), så att sidorna inte ritas om
  const files = useMemo(() => (song ? songFiles(song) : []), [song?.attachment, song?.extraAttachments]);
  const { pages, status: pagesStatus } = useFilePages(files);
  const paged = !!song?.attachment && settings.filePaging !== false;
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [id]);
  // Zoom med två fingrar (eller knapparna) på sidan som visas; ny sida visas hel
  const [pageZoom, setPageZoom] = useState<PageZoom>(NO_ZOOM);
  const [zoomStep, setZoomStep] = useState<{ id: number; factor: number }>();
  useEffect(() => setPageZoom(NO_ZOOM), [id, page]);
  const lastPage = Math.max(0, pages.length - 1);
  const turnPage = (d: number) => {
    const n = Math.max(0, Math.min(lastPage, page + d));
    if (n === page) return false;
    setPage(n);
    scrollRef.current?.scrollTo({ top: 0 });
    return true;
  };
  // För tangentbordet (som lyssnar en gång per låt)
  const turnPageRef = useRef(turnPage);
  const pagedRef = useRef(paged);
  useEffect(() => {
    turnPageRef.current = paged ? turnPage : () => false;
    pagedRef.current = paged;
  });

  // Två spalter på en bred skärm i liggande läge, men bara när hela låten då får plats
  const wide = useMediaQuery('(min-width: 900px) and (orientation: landscape)');
  const wantColumns = wide && settings.twoColumns !== false && !song?.attachment;
  // Ryms låten inte i två spalter krymps texten (ner till FIT_MIN_FONT) tills den gör det;
  // annars en spalt i vald textstorlek. Inställningen för textstorlek ändras inte.
  const [fit, setFit] = useState({ font: settings.fontSize, ok: true });
  const columns = wantColumns && fit.ok;
  const fontSize = columns ? Math.min(fit.font, settings.fontSize) : settings.fontSize;
  // Ökar när låtytans höjd ändras (t.ex. när kontrollerna eller ackorddiagrammen visas)
  const [areaHeight, setAreaHeight] = useState(0);
  const metrics = useLineMetrics(songRef, [parsed, showChords, fontSize, transpose, stage, song?.id, columns, settings.simplifyChords]);

  const writeLayer = useCallback(
    (next: Annotations) => {
      if (layer === 'song') return void updateSongPrefs(id, { annotations: next });
      if (!setlist || !setlistItem) return;
      const own = hasAnnotations(next) ? next : undefined;
      void saveSetlist({ ...setlist, items: setlist.items.map((x) => (x.id === setlistItem.id ? { ...x, ownAnnotations: own } : x)) });
    },
    [layer, id, setlist, setlistItem, updateSongPrefs, saveSetlist],
  );

  const updateAnnotations = useCallback(
    (next: Annotations, commit: boolean) => {
      if (!commit) {
        setDraft(next);
        return;
      }
      history.current.push(saved);
      if (history.current.length > 50) history.current.shift();
      setDraft(null);
      writeLayer(next);
    },
    [saved, writeLayer],
  );

  const gestures = useAnnotationGestures({
    enabled: annotating,
    tool,
    setTool,
    scrollRef,
    songRef,
    metrics,
    annotations,
    inkColor,
    inkWidth,
    update: updateAnnotations,
    selectedId,
    setSelectedId,
    editingId,
    setEditingId,
    setLive,
  });

  // När redigeringen av en lapp avslutas (även utan att textrutan hann tappa fokus): spara texten
  const prevEditing = useRef<string | null>(null);
  useEffect(() => {
    if (prevEditing.current && !editingId && draft) updateAnnotations(draft, true);
    prevEditing.current = editingId;
  }, [editingId, draft, updateAnnotations]);

  const annotatingRef = useRef(annotating);
  annotatingRef.current = annotating;

  // Annat lager: det som pågår och ångra-historiken hör till det förra
  useEffect(() => {
    gestures.reset();
    setLive(null);
    setDraft(null);
    setSelectedId(null);
    setEditingId(null);
    history.current = [];
  }, [layer]);

  // Ny låt: nollställ anteckningsläget
  useEffect(() => {
    // Även gesternas tillstånd, så att inget från förra låten hamnar på den nya
    gestures.reset();
    setAnnotating(false);
    setLive(null);
    setDraft(null);
    setSelectedId(null);
    setEditingId(null);
    history.current = [];
  }, [id]);

  const goSetlist = useCallback(
    (delta: number) => {
      if (!setlist) return;
      const next = setlistIndex + delta;
      if (next < 0 || next >= setlistItems.length) return;
      setScrolling(false);
      navigate(itemPath(setlist.id, setlistItems[next], next), { replace: true });
    },
    [setlist, setlistIndex, setlistItems, navigate],
  );

  // Stor swipe åt vänster/höger byter låt i setlistan; i en fil först sida, sedan låt
  const canPrevSong = !!setlist && setlistIndex > 0;
  const canNextSong = !!setlist && setlistIndex >= 0 && setlistIndex < setlistItems.length - 1;
  const swipe = useSwipeNavigation({
    enabled: (!!setlist || paged) && !annotating,
    canPrev: (paged && page > 0) || canPrevSong,
    canNext: (paged && page < lastPage) || canNextSong,
    onPrev: () => turnPageRef.current(-1) || goSetlist(-1),
    onNext: () => turnPageRef.current(1) || goSetlist(1),
  });

  // Metronom i låtens tempo, med takten från {time}
  const bpm = parseTempo(parsed.meta.tempo);
  const beats = beatsPerBar(parsed.meta.time);
  const [ticking, setTicking] = useState(false);
  const metroRef = useRef<HTMLButtonElement>(null);
  const metronome = useRef<Metronome | null>(null);
  const toggleMetronome = () => {
    if (!bpm) return;
    // Knappen blinkar i takt, starkare på första slaget
    metronome.current ??= new Metronome((beat) => {
      const el = metroRef.current;
      if (!el) return;
      el.classList.remove('tick', 'tick-accent');
      void el.offsetWidth;
      el.classList.add(beat === 0 ? 'tick-accent' : 'tick');
    });
    if (metronome.current.running) {
      metronome.current.stop();
      setTicking(false);
    } else {
      metronome.current.start(bpm, beats);
      setTicking(true);
    }
  };
  // Tystnar när låten byts eller sidan lämnas
  useEffect(() => {
    metronome.current?.stop();
    setTicking(false);
  }, [id]);
  useEffect(() => () => metronome.current?.close(), []);

  // Får låten inte plats i två spalter: mindre text, och till sist en spalt som vanligt (prövas
  // om när något ändras, även sådant ovanför låten som tipset om kapo och höjden på ytan)
  const fitKey = [
    song?.id,
    song?.content,
    showChords,
    settings.fontSize,
    transpose,
    stage,
    wantColumns,
    settings.simplifyChords,
    controlsHidden,
    settings.showDiagrams,
    !!pastNotes,
    areaHeight,
  ].join('|');
  useEffect(() => {
    const el = scrollRef.current;
    if ((!wantColumns && !paged) || !el) return;
    const ro = new ResizeObserver(() => setAreaHeight(Math.round(el.clientHeight)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [wantColumns, paged, id]);
  useLayoutEffect(() => setFit({ font: settings.fontSize, ok: true }), [fitKey]);
  // Mäts före ritningen: en mindre storlek i taget tills låten ryms (syns inte som flimmer)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const songEl = songRef.current;
    if (!columns || !el || !songEl) return;
    const bottom = songEl.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop;
    if (bottom <= el.clientHeight) return;
    const min = Math.min(FIT_MIN_FONT, settings.fontSize);
    setFit(fontSize - 1 >= min ? { font: fontSize - 1, ok: true } : { font: settings.fontSize, ok: false });
  }, [columns, fitKey, fontSize]);

  // Börja om från toppen när låten byts
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [id]);

  // Automatisk scroll
  useEffect(() => {
    if (!scrolling) return;
    const el = scrollRef.current;
    if (!el) return;
    let last = performance.now();
    let acc = el.scrollTop;
    let raf = 0;
    // Medan ett finger ligger på låten, och strax efter (så att svepets fart hinner klinga av),
    // väntar scrollningen och fortsätter sedan därifrån
    // Ett vanligt tryck (t.ex. för att visa kontrollerna) ger ingen paus efteråt
    let held = false;
    let pauseUntil = 0;
    let downTop = 0;
    const onDown = () => {
      held = true;
      downTop = el.scrollTop;
    };
    const onUp = () => {
      held = false;
      if (Math.abs(el.scrollTop - downTop) > 2) pauseUntil = performance.now() + 700;
    };
    const onWheel = () => (pauseUntil = performance.now() + 400);
    el.addEventListener('touchstart', onDown, { passive: true });
    el.addEventListener('touchend', onUp, { passive: true });
    el.addEventListener('touchcancel', onUp, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      raf = requestAnimationFrame(step);
      if (held || now < pauseUntil) {
        acc = el.scrollTop;
        return;
      }
      // Om användaren har scrollat manuellt: fortsätt därifrån
      if (Math.abs(el.scrollTop - acc) > 2) acc = el.scrollTop;
      const rest = el.scrollHeight - el.clientHeight;
      acc += (duration ? rest / duration : scrollPxPerSecond(speed)) * dt;
      el.scrollTop = acc;
      if (el.scrollTop >= rest - 1) {
        cancelAnimationFrame(raf);
        setScrolling(false);
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('touchstart', onDown);
      el.removeEventListener('touchend', onUp);
      el.removeEventListener('touchcancel', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [scrolling, speed, duration]);

  // Tangentbord: piltangenter/mellanslag (fungerar även med många bladvändarpedaler)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      // Inte medan en meny eller ruta är öppen, eller i anteckningsläget
      if (annotatingRef.current || document.querySelector('[role="dialog"]')) return;
      const el = scrollRef.current;
      // En fil i sidled: nästa/föregående sida, och efter sista sidan nästa låt i setlistan
      const step = { ArrowRight: 1, PageDown: 1, ArrowDown: 1, ' ': 1, ArrowLeft: -1, PageUp: -1, ArrowUp: -1 }[e.key];
      if (step && pagedRef.current) {
        e.preventDefault();
        if (!turnPageRef.current(step) && setlist) goSetlist(step);
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        setScrolling((v) => !v);
      } else if (e.key === 'ArrowRight' && setlist) {
        goSetlist(1);
      } else if (e.key === 'ArrowLeft' && setlist) {
        goSetlist(-1);
      } else if ((e.key === 'PageDown' || e.key === 'ArrowDown') && el) {
        e.preventDefault();
        el.scrollBy({ top: el.clientHeight * 0.8, behavior: 'smooth' });
      } else if ((e.key === 'PageUp' || e.key === 'ArrowUp') && el) {
        e.preventDefault();
        el.scrollBy({ top: -el.clientHeight * 0.8, behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goSetlist, setlist]);

  const setlistNav = setlist && (
    <div className="setlist-nav">
      <button className="btn" disabled={setlistIndex <= 0} onClick={() => goSetlist(-1)}>
        <ChevronLeft size={18} />
        <span className="hide-mobile">{setlistIndex > 0 ? itemTitle(setlistItems[setlistIndex - 1], songs) : 'Föregående'}</span>
      </button>
      <div className="pos">
        {setlist.name} · {setlistIndex + 1}/{setlistItems.length}
      </div>
      <button className="btn" disabled={setlistIndex >= setlistItems.length - 1} onClick={() => goSetlist(1)}>
        <span className="hide-mobile">
          {setlistIndex < setlistItems.length - 1 ? itemTitle(setlistItems[setlistIndex + 1], songs) : 'Nästa'}
        </span>
        <ChevronRight size={18} />
      </button>
    </div>
  );

  // Mellanpunkt i setlistan, t.ex. "Tal": visa texten stort
  const cueItem = setlist ? setlistItems[setlistIndex] : undefined;
  if (setlist && cueItem && isCue(cueItem)) {
    const next = setlistItems[setlistIndex + 1];
    return (
      <div className={`screen${stage ? ' stage' : ''}`}>
        {!stage && !controlsHidden && <Header title={setlist.name} back={`/setlists/${setlist.id}`} />}
        {stage && (
          <div className="stage-exit" style={{ top: 'calc(10px + var(--safe-top))' }}>
            <button className="btn icon" aria-label="Lämna scenläge" onClick={() => setStage(false)}>
              <X size={20} />
            </button>
          </div>
        )}
        <div className="song-area">
          <div
            className="song-scroll cue-scroll"
            ref={scrollRef}
            {...swipe.handlers}
            style={{ touchAction: 'pan-y' }}
            onClick={() => {
              if (swipe.justSwiped()) return;
              setControlsHidden((v) => !v);
            }}
          >
            <div className="cue-view" style={swipe.style}>
              <div className="cue-text" style={{ fontSize: Math.round(settings.fontSize * 2.6) }}>
                {itemTitle(cueItem, songs)}
              </div>
              {next && <div className="cue-next">Sedan: {itemTitle(next, songs)}</div>}
            </div>
          </div>
        </div>
        {setlistNav}
      </div>
    );
  }

  if (!song || song.deletedAt) {
    return (
      <div className="screen">
        <Header title="Låt" back="/" />
        <div className="empty">Låten finns inte.</div>
      </div>
    );
  }

  // Låten visas som en bifogad fil (t.ex. noter) i stället för text och ackord
  const isFile = !!song.attachment;
  // Ackorden visas som grepp när låten har kapo
  const ctx = displayChordContext(parsed, transpose, settings.notation, settings.simplifyChords);
  const capo = capoOf(parsed);
  const displayChords = parsed.chords.filter((c) => !c.startsWith('*')).map((c) => formatChord(c, ctx));
  const uniqueChords = [...new Set(displayChords)];

  // I en setlista: tonart och kapo ändras bara där, eller för låten överallt (valet sparas)
  const inSetlist = scopeSetlist;
  const setItem = (patch: { transpose?: number; capo?: number }) =>
    setlist && setlistItem && void saveSetlist({ ...setlist, items: setlist.items.map((x) => (x.id === setlistItem.id ? { ...x, ...patch } : x)) });
  const setTranspose = (n: number) => {
    const t = normalizeTranspose(n);
    // Samma som låtens egen: setlistan följer låten igen
    if (inSetlist) return setItem({ transpose: t === song.transpose ? undefined : t });
    // Överallt: setlistan följer låtens tonart igen
    if (setlistItem?.transpose !== undefined) setItem({ transpose: undefined });
    void updateSongPrefs(song.id, { transpose: t });
  };
  // Låtens eget kapo sparas i låten ({capo}), så att det följer med i synk, export och redigering
  const songCapo = capoOf(songParsed);
  const setCapo = (n: number) => {
    const next = Math.max(0, Math.min(11, n));
    if (next === capo) return;
    if (inSetlist) return setItem({ capo: next === songCapo ? undefined : next });
    if (setlistItem?.capo !== undefined) setItem({ capo: undefined });
    if (next !== songCapo) void saveSong({ id: song.id, content: upsertDirective(song.content, 'capo', next ? String(next) : '') });
  };
  // Samma val för tonart och kapo; knappen visas vid båda så att det syns vad som gäller
  const scopeButton = setlistItem && (
    <button
      className={`btn small scope-btn${inSetlist ? ' active' : ''}`}
      title={inSetlist ? 'Tonart, kapo och anteckningar ändras bara i den här setlistan' : 'Tonart, kapo och anteckningar ändras för låten överallt'}
      onClick={() => void updateSettings({ transposeScope: inSetlist ? 'global' : 'setlist' })}
    >
      {inSetlist ? 'I setlistan' : 'Överallt'}
    </button>
  );
  const setFont = (n: number) => void updateSettings({ fontSize: Math.max(MIN_FONT, Math.min(MAX_FONT, n)) });
  // En fil i sidled: knapparna zoomar sidan (som med två fingrar), annars textstorlek/bredd
  const zoomOut = () => (paged ? setZoomStep({ id: Date.now(), factor: 0.8 }) : setFont(settings.fontSize - 2));
  const zoomIn = () => (paged ? setZoomStep({ id: Date.now(), factor: 1.25 }) : setFont(settings.fontSize + 2));
  const setSpeed = (n: number) => void updateSongPrefs(song.id, { scrollSpeed: Math.max(1, Math.min(10, n)) });
  const hasDuration = parseDuration(parsed.meta.duration) !== undefined;
  // Från låtens längd till en egen hastighet: börja från den nivå som ligger närmast
  const changeSpeed = (delta: number) => {
    const el = scrollRef.current;
    if (!duration || !el) return setSpeed(speed + delta);
    const pxs = (el.scrollHeight - el.clientHeight) / duration;
    let nearest = 1;
    for (let l = 1; l <= 10; l++) if (Math.abs(scrollPxPerSecond(l) - pxs) < Math.abs(scrollPxPerSecond(nearest) - pxs)) nearest = l;
    setSpeed(nearest + delta);
  };

  const exportCho = async () => {
    setMenu(false);
    try {
      await saveTextFile(`${safeFileName(song.title)}.cho`, song.content);
    } catch (e) {
      toastError(e, 'Kunde inte exportera');
    }
  };

  const applyTranspose = async () => {
    setMenu(false);
    if (!transpose) return;
    if (!confirm('Skriva in transponeringen permanent i låttexten? Ackorden i källtexten ändras.')) return;
    const content = transposeSource(song.content, {
      transpose,
      preferFlats,
      notation: parsed.hNotation ? 'swedish' : 'international',
    });
    await saveSong({ id: song.id, content });
    // Låtens och setlistornas egna tonarter utgår från texten och flyttas lika mycket
    await updateSongPrefs(song.id, { transpose: normalizeTranspose(song.transpose - transpose) });
    for (const sl of Object.values(useStore.getState().setlists)) {
      if (sl.deletedAt || !sl.items.some((x) => x.songId === song.id && x.transpose !== undefined)) continue;
      await saveSetlist({
        ...sl,
        items: sl.items.map((x) =>
          x.songId === song.id && x.transpose !== undefined ? { ...x, transpose: normalizeTranspose(x.transpose - transpose) } : x,
        ),
      });
    }
    toast('Transponeringen är sparad i texten');
  };

  const remove = async () => {
    setMenu(false);
    if (!confirm(`Radera "${song.title}"?`)) return;
    await deleteSong(song.id);
    toast('Låten är raderad');
    navigate('/', { replace: true });
  };

  const backTo = setlist ? `/setlists/${setlist.id}` : '/';
  // Redigering från en setlista behåller platsen i setlistan
  const editPath = `/song/${song.id}/edit${setlist ? `?setlist=${setlist.id}&i=${setlistIndex}` : ''}`;
  const tapToHide = (stage || !!setlist) && !annotating;

  const selectedNote = annotations.notes.find((n) => n.id === selectedId) ?? null;
  const changeNote = (patch: Partial<StickyNote>) => {
    if (!selectedNote) return;
    updateAnnotations(
      { ...annotations, notes: annotations.notes.map((n) => (n.id === selectedNote.id ? { ...n, ...patch } : n)) },
      true,
    );
  };
  const startAnnotating = () => {
    setPastNotes(null);
    setControlsHidden(false);
    setScrolling(false);
    setAnnotating(true);
    if (!settings.showAnnotations) void updateSettings({ showAnnotations: true });
  };
  const stopAnnotating = () => {
    if (draft) updateAnnotations(draft, true);
    gestures.reset();
    setAnnotating(false);
    setSelectedId(null);
    setEditingId(null);
    setLive(null);
  };
  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    gestures.reset();
    setDraft(null);
    setSelectedId(null);
    setEditingId(null);
    writeLayer(prev);
  };
  const clearAnnotations = () => {
    if (!annotations.notes.length && !annotations.strokes.length) return;
    if (!confirm(layer === 'setlist' ? 'Radera alla anteckningar som bara gäller i den här setlistan?' : 'Radera alla anteckningar på den här låten?')) return;
    updateAnnotations(EMPTY_ANNOTATIONS, true);
    setSelectedId(null);
  };
  const showLayer = metrics && (settings.showAnnotations || annotating || !!pastNotes);

  return (
    <div className={`screen${stage ? ' stage' : ''}`}>
      {!stage && !controlsHidden && (
        <Header title={song.title} back={backTo}>
          <button className="btn ghost icon" aria-label="Redigera" onClick={() => navigate(editPath)}>
            <Pencil size={20} />
          </button>
          <button className="btn ghost icon" aria-label="Mer" onClick={() => setMenu(true)}>
            <MoreHorizontal size={22} />
          </button>
        </Header>
      )}

      {stage && (
        <div className="stage-exit" style={{ top: 'calc(10px + var(--safe-top))' }}>
          <button className="btn icon" aria-label="Lämna scenläge" onClick={() => setStage(false)}>
            <X size={20} />
          </button>
        </div>
      )}

      {annotating && (
        <AnnotationToolbar
          style={stage ? { paddingTop: 'calc(6px + var(--safe-top))', paddingRight: 64 } : undefined}
          tool={tool}
          setTool={(t) => {
            setTool(t);
            if (t !== 'move') setSelectedId(null);
            setEditingId(null);
          }}
          inkColor={inkColor}
          setInkColor={setInkColor}
          inkWidth={inkWidth}
          setInkWidth={setInkWidth}
          canUndo={history.current.length > 0}
          onUndo={undo}
          onClear={clearAnnotations}
          onDone={stopAnnotating}
          note={selectedNote}
          onNoteChange={changeNote}
          onNoteDelete={() => {
            if (!selectedNote) return;
            updateAnnotations({ ...annotations, notes: annotations.notes.filter((n) => n.id !== selectedNote.id) }, true);
            setSelectedId(null);
            setEditingId(null);
          }}
          onNoteEdit={() => selectedNote && setEditingId(selectedNote.id)}
          scope={setlistItem ? { inSetlist, onToggle: () => void updateSettings({ transposeScope: inSetlist ? 'global' : 'setlist' }) } : undefined}
        />
      )}

      {!controlsHidden && !annotating && (
        <div className="song-toolbar" style={stage ? { paddingTop: 'calc(6px + var(--safe-top))', paddingRight: 64 } : undefined}>
          {!isFile && (
          <div className="tool-group" title="Transponera">
            <button className="btn icon" aria-label="Transponera ner" onClick={() => setTranspose(transpose - 1)}>
              <Minus size={18} />
            </button>
            <span className="tool-value" onClick={() => setTranspose(0)}>
              {transpose > 0 ? `+${transpose}` : transpose === 0 ? '±0' : transpose}
            </span>
            <button className="btn icon" aria-label="Transponera upp" onClick={() => setTranspose(transpose + 1)}>
              <Plus size={18} />
            </button>
            {scopeButton}
          </div>
          )}

          {!isFile && (
          <div className="tool-group" title="Kapo">
            <button className="btn icon" aria-label="Kapo ner" disabled={capo <= 0} onClick={() => setCapo(capo - 1)}>
              <Minus size={18} />
            </button>
            <span className="tool-value capo-value" onClick={() => setCapo(0)}>
              {capo ? `Kapo ${capo}` : 'Kapo'}
            </span>
            <button className="btn icon" aria-label="Kapo upp" disabled={capo >= 11} onClick={() => setCapo(capo + 1)}>
              <Plus size={18} />
            </button>
            {scopeButton}
          </div>
          )}

          <div className="tool-group" title={isFile ? 'Zooma' : 'Textstorlek'}>
            <button className="btn icon" aria-label={isFile ? 'Zooma ut' : 'Mindre text'} onClick={zoomOut}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>A</span>
            </button>
            <button className="btn icon" aria-label={isFile ? 'Zooma in' : 'Större text'} onClick={zoomIn}>
              <span style={{ fontSize: 19, fontWeight: 700 }}>A</span>
            </button>
          </div>

          {/* En sida i taget: inget att scrolla */}
          {!paged && (
          <div className="tool-group" title="Automatisk scroll">
            <button
              className={`btn icon${scrolling ? ' active' : ''}`}
              aria-label={scrolling ? 'Pausa scroll' : 'Starta scroll'}
              onClick={() => setScrolling((v) => !v)}
            >
              {scrolling ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className="btn icon" aria-label="Långsammare" onClick={() => changeSpeed(-1)}>
              <Minus size={16} />
            </button>
            <span
              className="tool-value"
              title={duration ? 'Scrollar genom låten på dess längd' : hasDuration ? 'Tryck för att scrolla på låtens längd' : undefined}
              onClick={() => hasDuration && !duration && void updateSongPrefs(song.id, { scrollSpeed: undefined })}
            >
              {duration ? formatDuration(duration) : speed}
            </span>
            <button className="btn icon" aria-label="Snabbare" onClick={() => changeSpeed(1)}>
              <Plus size={16} />
            </button>
          </div>
          )}

          {bpm && (
            <div className="tool-group" title={`Metronom, ${bpm} slag per minut${parsed.meta.time ? ` i ${parsed.meta.time}` : ''}`}>
              <button
                ref={metroRef}
                className={`btn metro${ticking ? ' active' : ''}`}
                aria-label={ticking ? 'Stoppa metronomen' : 'Starta metronomen'}
                aria-pressed={ticking}
                onClick={toggleMetronome}
              >
                <MetronomeIcon size={18} />
                <span>{bpm}</span>
              </button>
            </div>
          )}

          <div className="tool-group">
            {!isFile && (
            <>
            <button
              className={`btn icon${showChords ? '' : ' active'}`}
              aria-label={showChords ? 'Dölj ackord' : 'Visa ackord'}
              title={showChords ? 'Dölj ackord' : 'Visa ackord'}
              onClick={() => setShowChords((v) => !v)}
            >
              {showChords ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
            <button
              className={`btn icon${settings.showDiagrams ? ' active' : ''}`}
              aria-label="Ackorddiagram"
              title="Ackorddiagram"
              onClick={() => updateSettings({ showDiagrams: !settings.showDiagrams })}
            >
              <Guitar size={18} />
            </button>
            <button className="btn icon" aria-label="Anteckna" title="Anteckna och rita" onClick={startAnnotating}>
              <PenLine size={18} />
            </button>
            {/* Bara när det finns något att visa eller dölja (gäller alla låtar) */}
            {hasAnnotations(mergeAnnotations(song.annotations, setlistItem?.ownAnnotations)) && (
              <button
                className={`btn icon${settings.showAnnotations ? '' : ' active'}`}
                aria-label={settings.showAnnotations ? 'Dölj anteckningar' : 'Visa anteckningar'}
                title={settings.showAnnotations ? 'Dölj anteckningar' : 'Visa anteckningar'}
                aria-pressed={!settings.showAnnotations}
                onClick={() => updateSettings({ showAnnotations: !settings.showAnnotations })}
              >
                {settings.showAnnotations ? <NoteIcon size={18} /> : <NoteOffIcon size={18} />}
              </button>
            )}
            </>
            )}
            <button
              className={`btn icon${stage ? ' active' : ''}`}
              aria-label="Scenläge"
              title="Scenläge"
              onClick={() => setStage((v) => !v)}
            >
              <Moon size={18} />
            </button>
          </div>
        </div>
      )}

      {!isFile && settings.showDiagrams && showChords && uniqueChords.length > 0 && !controlsHidden && (
        <div className="diagram-strip">
          {uniqueChords.map((c) => (
            <ChordDiagram key={c} chord={c} instrument={settings.instrument} scale={0.9} onClick={() => setChordSheet(c)} />
          ))}
        </div>
      )}

      <div className="song-area">
        <div
          className={`song-scroll${annotating ? ' annotating' : ''}`}
          ref={scrollRef}
          onPointerDown={annotating ? gestures.onPointerDown : swipe.handlers.onPointerDown}
          onPointerMove={annotating ? gestures.onPointerMove : swipe.handlers.onPointerMove}
          onPointerUp={annotating ? gestures.onPointerUp : swipe.handlers.onPointerUp}
          onPointerCancel={annotating ? gestures.onPointerCancel : swipe.handlers.onPointerCancel}
          style={{
            ...(controlsHidden && !stage ? { paddingTop: 'calc(18px + var(--safe-top))' } : {}),
            // Luften nedanför behövs bara för att kunna scrolla låtens slut upp på skärmen
            ...(paged ? { paddingBottom: 80 } : {}),
            // Webbläsaren sköter vertikal scroll; swipe i sidled hanteras av appen
            ...((setlist || paged) && !annotating ? { touchAction: 'pan-y' } : {}),
          }}
          onClick={(e) => {
            if (swipe.justSwiped()) return;
            // I setlistläge och scenläge: tryck på låten för att visa/dölja kontrollerna överst
            if (tapToHide && !(e.target as HTMLElement).closest('.ch')) setControlsHidden((v) => !v);
          }}
        >
          {/* En fil i sidled flyttar sidorna själv; annars följer hela låten fingret */}
          <div style={paged ? undefined : swipe.style}>
          {pastNotes && (
            <div className="tip small-text past-notes" onClick={(e) => e.stopPropagation()}>
              <div>
                Anteckningar från <b>{pastNotes.label}</b>
              </div>
              <div className="btn-row">
                <button
                  className="btn small"
                  onClick={() => {
                    if (hasAnnotations(song.annotations) && !confirm('Ersätta låtens nuvarande anteckningar med dessa?')) return;
                    // Alltid på låten (kopian innehåller båda lagren från då)
                    void updateSongPrefs(song.id, { annotations: pastNotes.annotations });
                    setPastNotes(null);
                    toast('Anteckningarna är återställda');
                  }}
                >
                  Använd dessa
                </button>
                <button className="btn small primary" onClick={() => setPastNotes(null)}>
                  Stäng
                </button>
              </div>
            </div>
          )}
          {!stage && !controlsHidden && !annotating && askSubtitleArtist(song) && (
            <div className="tip small-text capo-tip" onClick={(e) => e.stopPropagation()}>
              <div>
                Är <span style={{ fontWeight: 600 }}>{song.subtitle}</span> artisten? Det står nu som undertitel.
              </div>
              <div className="btn-row">
                <button className="btn small" onClick={() => void updateSongPrefs(song.id, { subtitleNotArtist: song.subtitle })}>
                  Nej
                </button>
                <button
                  className="btn small primary"
                  onClick={() =>
                    void saveSong({ id: song.id, content: subtitleToArtist(song.content, song.subtitle!) }).then(() => toast('Artisten är ändrad'))
                  }
                >
                  Ja, gör till artist
                </button>
              </div>
            </div>
          )}
          {!isFile && !stage && !controlsHidden && !annotating && itemCapo === undefined && capoShapeShift(songParsed) > 0 && (
            <div className="tip small-text capo-tip" onClick={(e) => e.stopPropagation()}>
              <div>
                Ackorden verkar vara skrivna som grepp för kapo {capo}, men tonarten är {parsed.meta.key}. Skriv om
                ackorden till {parsed.meta.key}, så visas greppen rätt med kapot.
              </div>
              <button
                className="btn small primary"
                onClick={() => void saveSong({ id: song.id, content: shapesToSounding(song.content) }).then(() => toast('Ackorden är omskrivna'))}
              >
                Skriv om till {parsed.meta.key}
              </button>
            </div>
          )}
          {isFile ? (
            <div className={`song file-song${paged ? ' paged' : ''}`} style={{ fontSize: settings.fontSize }}>
              {/* I sidled syns titeln redan överst; sidan får hela höjden */}
              {!paged && (
                <div className="song-head">
                  <h2>{song.title}</h2>
                  {song.artist && <div className="artist">{song.artist}</div>}
                </div>
              )}
              <AttachmentView
                pages={pages}
                status={pagesStatus}
                zoom={settings.fontSize / 20}
                paged={
                  paged
                    ? {
                        page,
                        drag: swipe.offset,
                        dragging: swipe.offset !== 0,
                        pageZoom,
                        onZoom: setPageZoom,
                        onGestureStart: swipe.cancel,
                        zoomStep,
                        // Låtytan minus luften ovanför och sidvisaren nedanför
                        viewHeight: (areaHeight || scrollRef.current?.clientHeight || 600) - (pages.length > 1 ? 76 : 36),
                      }
                    : undefined
                }
              />
            </div>
          ) : (
          <SongRenderer
            song={parsed}
            opts={{
              transpose,
              notation: settings.notation,
              showChords,
              fontSize,
              columns: columns ? 2 : 1,
              simplify: settings.simplifyChords,
              onChordClick: annotating ? undefined : setChordSheet,
            }}
            containerRef={songRef}
            overlay={
              showLayer ? (
                <>
                {!pastNotes && (settings.showAnnotations || annotating) && hasAnnotations(otherLayer) && (
                  <AnnotationLayer
                    annotations={otherLayer!}
                    metrics={metrics}
                    live={null}
                    interactive={false}
                    dim={annotating}
                    selectedId={null}
                    editingId={null}
                    onTextChange={() => undefined}
                    onTextDone={() => undefined}
                  />
                )}
                <AnnotationLayer
                  annotations={pastNotes ? pastNotes.annotations : settings.showAnnotations || annotating ? annotations : EMPTY_ANNOTATIONS}
                  metrics={metrics}
                  live={live}
                  interactive={annotating}
                  selectedId={selectedId}
                  editingId={editingId}
                  onTextChange={(nid, text) =>
                    updateAnnotations(
                      { ...annotations, notes: annotations.notes.map((n) => (n.id === nid ? { ...n, text } : n)) },
                      false,
                    )
                  }
                  onTextDone={() => {
                    if (draft) updateAnnotations(draft, true);
                    setEditingId(null);
                  }}
                />
                </>
              ) : null
            }
          />
          )}
          {nextUp && !annotating && (!paged || page >= lastPage) && (
            <button
              className="next-up"
              onClick={(e) => {
                e.stopPropagation();
                goSetlist(1);
              }}
            >
              <span className="muted">Sedan:</span> <b>{nextUp.title}</b>
              {nextUp.key && <span className="muted"> · {nextUp.key}</span>}
              {nextUp.capo && <span className="muted"> · kapo {nextUp.capo}</span>}
              <ChevronRight size={18} />
              {nextUp.chords && nextUp.chords.length > 0 && <span className="next-chords">{nextUp.chords.join('  ')}</span>}
            </button>
          )}
          </div>
        </div>
        {paged && pages.length > 1 && (
          <div className="page-turner">
            <button className="btn icon ghost" aria-label="Föregående sida" disabled={page <= 0} onClick={() => turnPage(-1)}>
              <ChevronLeft size={18} />
            </button>
            <span>
              {page + 1} / {pages.length}
            </span>
            <button className="btn icon ghost" aria-label="Nästa sida" disabled={page >= lastPage} onClick={() => turnPage(1)}>
              <ChevronRight size={18} />
            </button>
          </div>
        )}
        {!paged && (
        <button
          className={`scroll-fab${scrolling ? ' on' : ''}`}
          aria-label={scrolling ? 'Pausa scroll' : 'Starta scroll'}
          onClick={() => setScrolling((v) => !v)}
        >
          {scrolling ? <Pause size={24} /> : <Play size={24} />}
        </button>
        )}
      </div>

      {setlistNav}

      {chordSheet && <ChordSheet chord={chordSheet} instrument={settings.instrument} onClose={() => setChordSheet(null)} />}

      {menu && (
        <Sheet title={song.title} onClose={() => setMenu(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn" onClick={() => navigate(editPath)}>
              <Pencil size={18} /> Redigera
            </button>
            <button
              className="btn"
              onClick={() => {
                setMenu(false);
                setAddToSetlist(true);
              }}
            >
              <ListMusic size={18} /> Lägg till i setlista
            </button>
            <button
              className="btn"
              onClick={() => {
                setMenu(false);
                setShowHistory(true);
              }}
            >
              <History size={18} /> Historik
            </button>
            {isFile ? (
              <button
                className="btn"
                onClick={() => {
                  setMenu(false);
                  setShowFiles(true);
                }}
              >
                <Files size={18} /> Filer ({files.length})
              </button>
            ) : (
              <>
                <button className="btn" disabled={!transpose} onClick={applyTranspose}>
                  <Wand2 size={18} /> Skriv in transponeringen i texten
                </button>
                <button className="btn" onClick={exportCho}>
                  <Download size={18} /> Exportera som ChordPro (.cho)
                </button>
              </>
            )}
            <button className="btn danger" onClick={remove}>
              <Trash size={18} /> Radera låten
            </button>
          </div>
        </Sheet>
      )}

      {addToSetlist && <AddToSetlistSheet songId={song.id} onClose={() => setAddToSetlist(false)} />}

      {showFiles && <FilesSheet song={song} onClose={() => setShowFiles(false)} />}

      {showHistory && (
        <HistorySheet
          song={song}
          onClose={() => setShowHistory(false)}
          onShowNotes={(a, label) => {
            setShowHistory(false);
            setAnnotating(false);
            setPastNotes({ annotations: a, label });
          }}
        />
      )}
    </div>
  );
}

/** Låtens filer: fler sidor (PDF:er eller bilder) läggs till, flyttas och tas bort. */
function FilesSheet({ song, onClose }: { song: Song; onClose: () => void }) {
  const saveSong = useStore((s) => s.saveSong);
  const files = songFiles(song);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const save = (next: SongAttachment[]) => saveSong({ id: song.id, content: song.content, files: next });
  const move = (i: number) => void save(files.map((f, j) => (j === i - 1 ? files[i] : j === i ? files[i - 1] : f)));
  const remove = (i: number) => {
    if (!confirm(`Ta bort ${files[i].name} från låten?`)) return;
    void save(files.filter((_, j) => j !== i));
  };
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      const added: SongAttachment[] = [];
      for (const f of Array.from(list)) added.push(await fileToAttachment(f));
      await save([...files, ...added]);
      toast(added.length === 1 ? 'Filen är tillagd' : `${added.length} filer är tillagda`);
    } catch (e) {
      toastError(e, 'Filen kunde inte läggas till');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Filer" onClose={onClose}>
      <p className="muted small-text" style={{ marginTop: 0 }}>
        Filerna visas i den här ordningen, t.ex. sida 1 och sida 2 av noterna.
      </p>
      <div className="file-list">
        {files.map((a, i) => (
          <div className="file-row" key={i}>
            {a.kind === 'pdf' ? <FileText size={18} /> : <ImageIcon size={18} />}
            <span className="name">{a.name}</span>
            <button className="btn icon ghost" aria-label={`Flytta upp ${a.name}`} disabled={i === 0} onClick={() => move(i)}>
              <ArrowUp size={18} />
            </button>
            {/* Den sista filen tas bort genom att radera låten */}
            <button className="btn icon ghost danger" aria-label={`Ta bort ${a.name}`} disabled={files.length === 1} onClick={() => remove(i)}>
              <X size={18} />
            </button>
          </div>
        ))}
      </div>
      <div className="label" style={{ marginTop: 14 }}>
        Lägg till
      </div>
      <div className="btn-row">
      <label className={`btn${busy ? ' disabled' : ''}`}>
        <FilePlus size={18} /> {busy ? 'Lägger till…' : 'Ny fil'}
        <input
          type="file"
          accept=".pdf,application/pdf,image/*"
          multiple
          hidden
          disabled={busy}
          onChange={(e) => {
            void add(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      <button className="btn" disabled={busy} onClick={() => setPicking(true)}>
        <Files size={18} /> Finns i appen
      </button>
      </div>
      {picking && <PickFileSongSheet song={song} onClose={() => setPicking(false)} />}
    </Sheet>
  );
}

/** En PDF eller bild som redan finns i appen: slå ihop låtarna, eller kopiera bara filerna. */
function PickFileSongSheet({ song, onClose }: { song: Song; onClose: () => void }) {
  const songsRec = useStore((s) => s.songs);
  const saveSong = useStore((s) => s.saveSong);
  const [query, setQuery] = useState('');
  const [other, setOther] = useState<Song | null>(null);
  const [busy, setBusy] = useState(false);
  const candidates = useMemo(
    () => sortSongs(filterSongs(liveSongs(songsRec).filter((s) => s.attachment && s.id !== song.id), { query, fullText: false, tags: [] }), 'title'),
    [songsRec, song.id, query],
  );
  const run = async (merge: boolean) => {
    if (!other) return;
    setBusy(true);
    try {
      if (merge) await mergeSongs([song.id, other.id]);
      else await saveSong({ id: song.id, content: song.content, files: [...songFiles(song), ...songFiles(other)] });
      toast(merge ? `${other.title} är ihopslagen med låten` : 'Filerna är tillagda');
      onClose();
    } catch (e) {
      toastError(e, 'Filerna kunde inte läggas till');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={other ? other.title : 'Välj en låt med filer'} onClose={onClose}>
      {other ? (
        <>
          <p className="muted small-text" style={{ marginTop: 0 }}>
            {songFiles(other).length === 1 ? 'Filen' : `De ${songFiles(other).length} filerna`} i {other.title} läggs till sist i{' '}
            {song.title}.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Varje val med sin förklaring i samma knapp */}
            <button className="choice-btn" disabled={busy} onClick={() => void run(true)}>
              <span className="choice-title">Slå ihop till en låt</span>
              <span className="muted small-text">
                {other.title} tas bort, och setlistor som har den får {song.title} i stället.
              </span>
            </button>
            <button className="choice-btn" disabled={busy} onClick={() => void run(false)}>
              <span className="choice-title">Kopiera bara filerna</span>
              <span className="muted small-text">{other.title} finns kvar som egen låt.</span>
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => setOther(null)}>
              Välj en annan
            </button>
          </div>
        </>
      ) : (
        <>
          <input
            className="input"
            type="search"
            placeholder="Sök titel eller artist"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="file-list" style={{ marginTop: 10 }}>
            {candidates.length === 0 && <p className="muted small-text">Inga andra låtar med PDF:er eller bilder.</p>}
            {candidates.map((s) => (
              <button key={s.id} className="file-row pick-row" onClick={() => setOther(s)}>
                {s.attachment!.kind === 'pdf' ? <FileText size={18} /> : <ImageIcon size={18} />}
                <span className="name">
                  {s.title}
                  {s.artist && <span className="muted"> – {s.artist}</span>}
                </span>
                {songFiles(s).length > 1 && <span className="badge">{songFiles(s).length}</span>}
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

function HistorySheet({
  song,
  onClose,
  onShowNotes,
}: {
  song: Song;
  onClose: () => void;
  onShowNotes: (annotations: Annotations, label: string) => void;
}) {
  const navigate = useNavigate();
  const setlists = useStore((s) => s.setlists);
  const songs = useStore((s) => s.songs);
  const notation = useStore((s) => s.settings.notation);
  const history = useMemo(() => songHistory(song.id, setlists, songs), [song.id, setlists, songs]);
  const last = lastPlayed(history);
  const label = (h: (typeof history)[number]) => `${h.setlist.name}${h.setlist.date ? `, ${formatDate(h.setlist.date)}` : ''}`;
  return (
    <Sheet title="Historik" onClose={onClose}>
      {history.length === 0 ? (
        <p className="muted">Låten finns inte i någon setlista än.</p>
      ) : (
        <>
          <p className="muted small-text" style={{ marginTop: 0 }}>
            {last ? (
              <>
                Senast spelad <b>{formatDate(last.setlist.date!)}</b> i {last.setlist.name}.
              </>
            ) : (
              'Ingen av setlistorna har ett datum som har varit.'
            )}{' '}
            Anteckningarna sparas när låten visas i setlistan.
          </p>
          <div className="list">
            {history.map((h) => {
              const k = song.attachment ? null : songKey(song, itemTranspose(h.item, song));
              return (
                <div className="list-item" key={h.setlist.id}>
                  <button
                    className="main history-open"
                    onClick={() => {
                      // Samma låt öppnas igen (bara setlistan i adressen ändras): stäng rutan först
                      onClose();
                      navigate(itemPath(h.setlist.id, h.item, h.index));
                    }}
                  >
                    <div className="title">{h.setlist.name}</div>
                    <div className="sub">
                      {h.setlist.date ? formatDate(h.setlist.date) : 'Utan datum'}
                      {k ? ` · ${formatKey(k.key, 0, notation)}` : ''}
                    </div>
                  </button>
                  {hasAnnotations(h.item.annotations) && (
                    <button className="btn small" onClick={() => onShowNotes(h.item.annotations!, label(h))}>
                      <PenLine size={15} /> Anteckningar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );
}

function AddToSetlistSheet({ songId, onClose }: { songId: string; onClose: () => void }) {
  const setlistsRec = useStore((s) => s.setlists);
  const saveSetlist = useStore((s) => s.saveSetlist);
  const setlists = liveSetlists(setlistsRec).sort((a, b) => b.updatedAt - a.updatedAt);
  const [name, setName] = useState('');

  const add = async (id?: string) => {
    if (id) {
      const sl = setlistsRec[id];
      await saveSetlist({ ...sl, items: [...sl.items, { id: newId(), songId }] });
      toast(`Tillagd i ${sl.name}`);
    } else {
      if (!name.trim()) return;
      await saveSetlist({ name: name.trim(), items: [{ id: newId(), songId }] });
      toast(`Setlistan ${name.trim()} skapades`);
    }
    onClose();
  };

  return (
    <Sheet title="Lägg till i setlista" onClose={onClose}>
      {setlists.length > 0 && (
        <div className="list" style={{ marginBottom: 16 }}>
          {setlists.map((sl) => (
            <div key={sl.id} className="list-item" onClick={() => add(sl.id)}>
              <div className="main">
                <div className="title">{sl.name}</div>
                <div className="sub">
                  {songCount(sl.items)} låtar{sl.items.some((i) => i.songId === songId) ? ' · finns redan med' : ''}
                </div>
              </div>
              <Plus size={18} />
            </div>
          ))}
        </div>
      )}
      <div className="field">
        <span>Ny setlista</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" value={name} placeholder="Namn" onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" disabled={!name.trim()} onClick={() => add()}>
            Skapa
          </button>
        </div>
      </div>
    </Sheet>
  );
}
