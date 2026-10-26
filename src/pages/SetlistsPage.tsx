import { useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Folder, FolderPlus, GripVertical, ListMusic, Pencil, Plus, Trash } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Header, Sheet, toast } from '../components/ui';
import { newId, type Setlist, type Song } from '../lib/model';
import { liveFolders, liveSetlists, useStore } from '../store/useStore';
import { useRememberScroll } from '../hooks/useRememberScroll';

// Ihopfällda mappar sparas mellan sidbyten under sessionen
const collapsed = new Set<string>();

// Tidpunkt då en dragning senast avslutades – så att släppet inte räknas som ett tryck på länken
let lastDragEnd = 0;

/** Så länge fingret ska hållas still innan en setlista blir dragbar (ms). */
const HOLD_DELAY = 500;
/** Hur långt fingret får röra sig under väntan innan det tolkas som scroll (px). */
const HOLD_TOLERANCE = 8;

/** Stoppar sidans scroll medan en setlista dras med fingret. */
function blockTouchScroll(e: TouchEvent) {
  e.preventDefault();
}

export function SetlistsPage() {
  const navigate = useNavigate();
  const scrollRef = useRememberScroll<HTMLDivElement>('setlists');
  const setlistsRec = useStore((s) => s.setlists);
  const foldersRec = useStore((s) => s.folders);
  const songs = useStore((s) => s.songs);
  const saveSetlist = useStore((s) => s.saveSetlist);
  const saveFolder = useStore((s) => s.saveFolder);
  const deleteFolder = useStore((s) => s.deleteFolder);
  // Från låtlistan: ny setlista med de markerade låtarna
  const location = useLocation();
  const [creating, setCreating] = useState<{ folderId: string; songIds?: string[] } | null>(() => {
    const ids = (location.state as { newSetlistSongs?: unknown } | null)?.newSetlistSongs;
    return Array.isArray(ids) && ids.length ? { folderId: '', songIds: ids.map(String) } : null;
  });
  // Läs låtarna en gång, så att rutan inte öppnas igen när man går tillbaka hit
  useEffect(() => {
    if ((location.state as { newSetlistSongs?: unknown } | null)?.newSetlistSongs) navigate('/setlists', { replace: true, state: null });
  }, [location.state, navigate]);
  const [folderSheet, setFolderSheet] = useState<{ id?: string; name: string } | null>(null);
  const [, rerender] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);

  // Mus: dra direkt. Pekskärm: håll fingret still en stund först, annars scrollar sidan som vanligt.
  // Separata sensorer för mus och beröring, så att en scrollande fingerrörelse aldrig startar en dragning.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: HOLD_DELAY, tolerance: HOLD_TOLERANCE } }),
  );

  const stopBlocking = () => document.removeEventListener('touchmove', blockTouchScroll);
  useEffect(() => stopBlocking, []);

  const onDragStart = (e: DragStartEvent) => {
    setDragId(String(e.active.id));
    document.addEventListener('touchmove', blockTouchScroll, { passive: false });
    navigator.vibrate?.(15);
  };
  const onDragEnd = (e: DragEndEvent) => {
    stopBlocking();
    setDragId(null);
    lastDragEnd = Date.now();
    const sl = setlistsRec[String(e.active.id)];
    const over = e.over ? String(e.over.id) : null;
    if (!sl || !over?.startsWith('folder:')) return;
    const folderId = over.slice('folder:'.length);
    if ((sl.folderId ?? '') === folderId) return;
    void saveSetlist({ ...sl, folderId: folderId || undefined });
    toast(folderId ? `Flyttad till ${foldersRec[folderId]?.name ?? 'mappen'}` : 'Flyttad till Utan mapp');
  };

  const folders = useMemo(() => liveFolders(foldersRec), [foldersRec]);
  const setlists = useMemo(
    () =>
      liveSetlists(setlistsRec).sort(
        (a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.updatedAt - a.updatedAt,
      ),
    [setlistsRec],
  );

  // Setlistor vars mapp saknas (t.ex. raderad på en annan enhet) hamnar under "Utan mapp"
  const byFolder = useMemo(() => {
    const map = new Map<string, Setlist[]>();
    for (const sl of setlists) {
      const key = sl.folderId && foldersRec[sl.folderId] && !foldersRec[sl.folderId].deletedAt ? sl.folderId : '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(sl);
    }
    return map;
  }, [setlists, foldersRec]);

  const toggle = (id: string) => {
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    rerender((n) => n + 1);
  };

  const unfiled = byFolder.get('') ?? [];
  const empty = setlists.length === 0 && folders.length === 0;
  const dragged = dragId ? setlistsRec[dragId] : undefined;

  return (
    <div className="screen">
      <Header title="Setlistor">
        <button className="btn ghost icon" aria-label="Ny mapp" title="Ny mapp" onClick={() => setFolderSheet({ name: '' })}>
          <FolderPlus size={21} />
        </button>
        <button className="btn primary icon-mobile" aria-label="Ny setlista" onClick={() => setCreating({ folderId: '' })}>
          <Plus size={18} /> <span className="hide-mobile">Ny setlista</span>
        </button>
      </Header>
      <div className="content narrow" ref={scrollRef}>
        <div>
          {empty ? (
            <div className="empty">
              <ListMusic size={48} />
              <p>Inga setlistor ännu.</p>
              <button className="btn primary" onClick={() => setCreating({ folderId: '' })}>
                Skapa setlista
              </button>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={() => {
                stopBlocking();
                setDragId(null);
              }}
            >
              {folders.length > 0 && setlists.length > 0 && (
                <p className="muted small-text" style={{ margin: '0 4px 10px' }}>
                  Håll in en setlista och dra den till en mapp för att flytta den.
                </p>
              )}
              {folders.map((f) => {
                const list = byFolder.get(f.id) ?? [];
                const open = !collapsed.has(f.id);
                return (
                  <DropZone id={`folder:${f.id}`} key={f.id}>
                    <div className="folder-head">
                      <button className="folder-toggle" onClick={() => toggle(f.id)} aria-expanded={open}>
                        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        <Folder size={18} />
                        <span className="folder-name">{f.name}</span>
                        <span className="muted small-text">{list.length}</span>
                      </button>
                      <button
                        className="btn ghost icon small"
                        aria-label={`Ny setlista i ${f.name}`}
                        title="Ny setlista i mappen"
                        onClick={() => setCreating({ folderId: f.id })}
                      >
                        <Plus size={18} />
                      </button>
                      <button
                        className="btn ghost icon small"
                        aria-label={`Byt namn på ${f.name}`}
                        title="Byt namn"
                        onClick={() => setFolderSheet({ id: f.id, name: f.name })}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="btn ghost icon small danger"
                        aria-label={`Radera ${f.name}`}
                        title="Radera mappen"
                        onClick={async () => {
                          const msg = list.length
                            ? `Radera mappen "${f.name}"? Setlistorna i den flyttas till "Utan mapp".`
                            : `Radera mappen "${f.name}"?`;
                          if (confirm(msg)) await deleteFolder(f.id);
                        }}
                      >
                        <Trash size={16} />
                      </button>
                    </div>
                    {open &&
                      (list.length ? (
                        <SetlistList setlists={list} songs={songs} />
                      ) : (
                        <div className="muted small-text folder-empty">
                          {dragId ? 'Släpp här för att flytta hit' : 'Mappen är tom.'}
                        </div>
                      ))}
                  </DropZone>
                );
              })}

              {(unfiled.length > 0 || (dragId && folders.length > 0)) && (
                <DropZone id="folder:">
                  {folders.length > 0 && (
                    <div className="folder-head">
                      <button className="folder-toggle" onClick={() => toggle('')} aria-expanded={!collapsed.has('')}>
                        {collapsed.has('') ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                        <span className="folder-name muted">Utan mapp</span>
                        <span className="muted small-text">{unfiled.length}</span>
                      </button>
                    </div>
                  )}
                  {!collapsed.has('') &&
                    (unfiled.length ? (
                      <SetlistList setlists={unfiled} songs={songs} />
                    ) : (
                      <div className="muted small-text folder-empty">Släpp här för att ta ut ur mappen</div>
                    ))}
                </DropZone>
              )}

              <DragOverlay dropAnimation={null}>
                {dragged ? (
                  <div className="list-item drag-overlay">
                    <div className="main">
                      <div className="title">{dragged.name}</div>
                    </div>
                    <GripVertical size={18} />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </div>

      {creating && (
        <CreateSetlistSheet
          folderId={creating.folderId}
          songCount={creating.songIds?.length}
          onClose={() => setCreating(null)}
          onCreate={async (v) => {
            const items = (creating.songIds ?? []).filter((id) => songs[id] && !songs[id].deletedAt).map((songId) => ({ id: newId(), songId }));
            const sl = await saveSetlist({ ...v, items });
            setCreating(null);
            navigate(`/setlists/${sl.id}`);
          }}
        />
      )}

      {folderSheet && (
        <FolderSheet
          initial={folderSheet.name}
          isNew={!folderSheet.id}
          onClose={() => setFolderSheet(null)}
          onSave={async (name) => {
            await saveFolder({ id: folderSheet.id, name });
            setFolderSheet(null);
          }}
        />
      )}
    </div>
  );
}

function DropZone({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, isOver, active } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`folder${active ? ' drop-target' : ''}${isOver ? ' drop-over' : ''}`}>
      {children}
    </div>
  );
}

function SetlistList({ setlists, songs }: { setlists: Setlist[]; songs: Record<string, Song> }) {
  return (
    <div className="list">
      {setlists.map((sl) => (
        <SetlistRow key={sl.id} setlist={sl} songs={songs} />
      ))}
    </div>
  );
}

function SetlistRow({ setlist: sl, songs }: { setlist: Setlist; songs: Record<string, Song> }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: sl.id });
  const count = sl.items.filter((i) => songs[i.songId] && !songs[i.songId].deletedAt).length;

  // Visar att raden är på väg att bli dragbar medan fingret hålls still
  const [holding, setHolding] = useState(false);
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const endHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
    setHolding(false);
  };
  useEffect(() => endHold, []);
  useEffect(() => {
    if (isDragging) endHold();
  }, [isDragging]);

  const onTouchStart = (e: ReactTouchEvent<HTMLAnchorElement>) => {
    listeners?.onTouchStart?.(e);
    const t = e.touches[0];
    endHold();
    hold.current = { timer: window.setTimeout(() => setHolding(true), 150), x: t.clientX, y: t.clientY };
  };
  const onTouchMove = (e: ReactTouchEvent<HTMLAnchorElement>) => {
    const t = e.touches[0];
    if (hold.current && Math.hypot(t.clientX - hold.current.x, t.clientY - hold.current.y) > HOLD_TOLERANCE) endHold();
  };

  return (
    <Link
      ref={setNodeRef}
      className={`list-item draggable-row${isDragging ? ' dragging' : ''}${holding ? ' holding' : ''}`}
      to={`/setlists/${sl.id}`}
      onClick={(e) => {
        if (Date.now() - lastDragEnd < 400) e.preventDefault();
      }}
      onContextMenu={(e) => e.preventDefault()}
      {...listeners}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={endHold}
      onTouchCancel={endHold}
    >
      <div className="main">
        <div className="title">{sl.name}</div>
        <div className="sub">
          {sl.date ? formatDate(sl.date) + ' · ' : ''}
          {count} {count === 1 ? 'låt' : 'låtar'}
        </div>
      </div>
    </Link>
  );
}

/** Väljare för mapp, används när en setlista skapas eller redigeras. */
export function FolderSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const foldersRec = useStore((s) => s.folders);
  const folders = useMemo(() => liveFolders(foldersRec), [foldersRec]);
  if (!folders.length) return null;
  return (
    <label className="field">
      <span>Mapp</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Utan mapp</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function CreateSetlistSheet({
  folderId: initialFolder,
  songCount,
  onClose,
  onCreate,
}: {
  folderId: string;
  /** Antal markerade låtar från låtlistan som läggs i setlistan */
  songCount?: number;
  onClose: () => void;
  onCreate: (v: { name: string; date?: string; folderId?: string }) => void;
}) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [folderId, setFolderId] = useState(initialFolder);
  const create = () => {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), date: date || undefined, folderId: folderId || undefined });
  };
  return (
    <Sheet
      title="Ny setlista"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Avbryt
          </button>
          <button className="btn primary" disabled={!name.trim()} onClick={create}>
            Skapa
          </button>
        </>
      }
    >
      <label className="field">
        <span>Namn</span>
        <input
          className="input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          placeholder="t.ex. Spelning på Kulturhuset"
        />
      </label>
      <label className="field">
        <span>Datum (valfritt)</span>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <FolderSelect value={folderId} onChange={setFolderId} />
      {songCount ? (
        <p className="muted small-text">
          {songCount === 1 ? 'Den markerade låten läggs' : `De ${songCount} markerade låtarna läggs`} i setlistan, i den
          ordning de valdes.
        </p>
      ) : null}
    </Sheet>
  );
}

function FolderSheet({
  initial,
  isNew,
  onClose,
  onSave,
}: {
  initial: string;
  isNew: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const save = () => name.trim() && onSave(name.trim());
  return (
    <Sheet
      title={isNew ? 'Ny mapp' : 'Byt namn på mappen'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Avbryt
          </button>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>
            {isNew ? 'Skapa' : 'Spara'}
          </button>
        </>
      }
    >
      <label className="field">
        <span>Namn</span>
        <input
          className="input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="t.ex. Bröllop, Kyrkan, Övningar"
        />
      </label>
    </Sheet>
  );
}

export function formatDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
}
