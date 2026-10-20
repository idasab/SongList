import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { GripVertical, MoreHorizontal, Play, Plus, Search, X } from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Header, Sheet, toast } from '../components/ui';
import { filterSongs, sortSongs } from '../lib/search';
import { formatKey, parseKey } from '../lib/chords';
import { newId, type SetlistItem, type Song } from '../lib/model';
import { liveSongs, useStore } from '../store/useStore';
import { FolderSelect, formatDate } from './SetlistsPage';

export function SetlistPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const setlist = useStore((s) => s.setlists[id]);
  const songs = useStore((s) => s.songs);
  const notation = useStore((s) => s.settings.notation);
  const saveSetlist = useStore((s) => s.saveSetlist);
  const deleteSetlist = useStore((s) => s.deleteSetlist);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!setlist || setlist.deletedAt) {
    return (
      <div className="screen">
        <Header title="Setlista" back="/setlists" />
        <div className="empty">Setlistan finns inte.</div>
      </div>
    );
  }

  const items = setlist.items.filter((i) => songs[i.songId] && !songs[i.songId].deletedAt);

  const setItems = (next: SetlistItem[]) => void saveSetlist({ ...setlist, items: next });

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((i) => i.id === e.active.id);
    const to = items.findIndex((i) => i.id === e.over!.id);
    setItems(arrayMove(items, from, to));
  };

  const play = (index: number) => {
    const it = items[index];
    if (it) navigate(`/song/${it.songId}?setlist=${setlist.id}&i=${index}`);
  };

  return (
    <div className="screen">
      <Header title={setlist.name} back="/setlists">
        <button className="btn ghost icon" aria-label="Inställningar för setlistan" onClick={() => setEditing(true)}>
          <MoreHorizontal size={22} />
        </button>
        <button className="btn primary" disabled={!items.length} onClick={() => play(0)}>
          <Play size={18} /> Spela
        </button>
      </Header>
      <div className="content narrow">
        <div>
          <div className="muted small-text" style={{ margin: '0 4px 8px', display: 'flex', justifyContent: 'space-between' }}>
            <span>
              {setlist.date ? formatDate(setlist.date) + ' · ' : ''}
              {items.length} {items.length === 1 ? 'låt' : 'låtar'}
            </span>
            {items.length > 1 && <span>Dra i handtaget för att ändra ordning</span>}
          </div>
          {setlist.notes && <div className="card small-text" style={{ whiteSpace: 'pre-wrap' }}>{setlist.notes}</div>}

          {items.length > 0 && (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <div className="list">
                  {items.map((it, idx) => (
                    <SortableRow
                      key={it.id}
                      item={it}
                      index={idx}
                      song={songs[it.songId]}
                      keyLabel={(() => {
                        const s = songs[it.songId];
                        const k = parseKey(s.key);
                        return k ? formatKey(k, s.transpose, notation) : '';
                      })()}
                      onOpen={() => play(idx)}
                      onRemove={() => setItems(items.filter((x) => x.id !== it.id))}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          <div style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => setAdding(true)}>
              <Plus size={18} /> Lägg till låtar
            </button>
          </div>
        </div>
      </div>

      {adding && (
        <AddSongsSheet
          existing={new Set(items.map((i) => i.songId))}
          onClose={() => setAdding(false)}
          onAdd={(ids) => {
            setItems([...items, ...ids.map((songId) => ({ id: newId(), songId }))]);
            setAdding(false);
            toast(`${ids.length} ${ids.length === 1 ? 'låt' : 'låtar'} tillagda`);
          }}
        />
      )}

      {editing && (
        <EditSetlistSheet
          folderId={setlist.folderId ?? ''}
          name={setlist.name}
          date={setlist.date ?? ''}
          notes={setlist.notes ?? ''}
          onClose={() => setEditing(false)}
          onSave={(v) => {
            void saveSetlist({
              ...setlist,
              ...v,
              date: v.date || undefined,
              notes: v.notes || undefined,
              folderId: v.folderId || undefined,
            });
            setEditing(false);
          }}
          onDuplicate={async () => {
            const copy = await saveSetlist({
              name: `${setlist.name} (kopia)`,
              folderId: setlist.folderId,
              date: setlist.date,
              notes: setlist.notes,
              items: items.map((i) => ({ id: newId(), songId: i.songId })),
            });
            setEditing(false);
            navigate(`/setlists/${copy.id}`, { replace: true });
          }}
          onDelete={async () => {
            if (!confirm(`Radera setlistan "${setlist.name}"? Låtarna finns kvar i biblioteket.`)) return;
            await deleteSetlist(setlist.id);
            navigate('/setlists', { replace: true });
          }}
        />
      )}
    </div>
  );
}

function SortableRow({
  item,
  index,
  song,
  keyLabel,
  onOpen,
  onRemove,
}: {
  item: SetlistItem;
  index: number;
  song: Song;
  keyLabel: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      className={`sortable-item${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span className="handle" {...attributes} {...listeners} aria-label="Flytta">
        <GripVertical size={20} />
      </span>
      <span className="num">{index + 1}</span>
      <div className="main" style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onOpen}>
        <div className="title" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {song.title}
        </div>
        {song.artist && <div className="muted small-text">{song.artist}</div>}
      </div>
      {keyLabel && <span className="key-badge">{keyLabel}</span>}
      <button className="btn ghost icon" aria-label="Ta bort ur setlistan" onClick={onRemove}>
        <X size={18} />
      </button>
    </div>
  );
}

function AddSongsSheet({
  existing,
  onAdd,
  onClose,
}: {
  existing: Set<string>;
  onAdd: (ids: string[]) => void;
  onClose: () => void;
}) {
  const songsRec = useStore((s) => s.songs);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const list = useMemo(
    () => sortSongs(filterSongs(liveSongs(songsRec), { query, fullText: false, tags: [] }), 'title'),
    [songsRec, query],
  );
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Sheet
      title="Lägg till låtar"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Avbryt
          </button>
          <button className="btn primary" disabled={!selected.length} onClick={() => onAdd(selected)}>
            Lägg till {selected.length || ''}
          </button>
        </>
      }
    >
      <div className="search-input" style={{ marginBottom: 8 }}>
        <Search size={18} />
        <input className="input" type="search" placeholder="Sök" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {list.map((s) => (
        <label key={s.id} className="check-item">
          <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{s.title}</div>
            <div className="muted small-text">
              {s.artist}
              {existing.has(s.id) ? (s.artist ? ' · ' : '') + 'finns redan i listan' : ''}
            </div>
          </div>
        </label>
      ))}
      {list.length === 0 && <p className="muted">Inga låtar hittades.</p>}
    </Sheet>
  );
}

function EditSetlistSheet(props: {
  folderId: string;
  name: string;
  date: string;
  notes: string;
  onClose: () => void;
  onSave: (v: { name: string; date: string; notes: string; folderId: string }) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(props.name);
  const [date, setDate] = useState(props.date);
  const [notes, setNotes] = useState(props.notes);
  const [folderId, setFolderId] = useState(props.folderId);
  return (
    <Sheet
      title="Setlista"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn danger" style={{ marginRight: 'auto' }} onClick={props.onDelete}>
            Radera
          </button>
          <button className="btn" onClick={props.onDuplicate}>
            Duplicera
          </button>
          <button className="btn primary" disabled={!name.trim()} onClick={() => props.onSave({ name: name.trim(), date, notes, folderId })}>
            Spara
          </button>
        </>
      }
    >
      <label className="field">
        <span>Namn</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Datum</span>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <FolderSelect value={folderId} onChange={setFolderId} />
      <label className="field">
        <span>Anteckningar</span>
        <textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
    </Sheet>
  );
}
