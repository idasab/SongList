import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { GripVertical, MessageSquareText, MoreHorizontal, Pencil, Play, Plus, Search, Share, X } from 'lucide-react';
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
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Header, Segmented, Sheet, askText, toast, toastError } from '../components/ui';
import { EmailInput, rememberEmails } from '../components/EmailInput';
import {
  EXPORT_FORMATS,
  buildSongFiles,
  exportSetlist,
  mailBody,
  mailSubject,
  type SetlistExportFormat,
} from '../services/setlistExport';
import {
  canComposeNatively,
  canShareFiles,
  composeNativeMail,
  downloadAndOpenMail,
  shareFilesWeb,
  type MailOutcome,
  type MailRequest,
} from '../services/mail';
import { filterSongs, songKey, sortSongs } from '../lib/search';
import { formatKey } from '../lib/chords';
import { newId, type SetlistItem, type Song } from '../lib/model';
import { allTags, liveSongs, useStore } from '../store/useStore';
import { FolderSelect, formatDate } from './SetlistsPage';
import { isCue, itemPath, itemTranspose, liveItems, moveVisible, songCount } from '../lib/setlist';

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
  const [exporting, setExporting] = useState(false);

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

  const items = liveItems(setlist.items, songs);
  const nSongs = songCount(items);
  // Låtarna numreras; mellanpunkter får ingen siffra
  const numbers: number[] = [];
  items.reduce((n, it) => {
    numbers.push(isCue(it) ? 0 : n + 1);
    return isCue(it) ? n : n + 1;
  }, 0);

  const askCue = (initial: string, isNew: boolean) =>
    askText({
      title: isNew ? 'Text mellan låtarna' : 'Ändra text',
      label: 'Visas på skärmen när du bläddrar dit, t.ex. Tal eller Paus',
      initial,
      confirmLabel: isNew ? 'Lägg till' : 'Spara',
    });

  const addCue = async () => {
    const text = (await askCue('Tal', true))?.trim();
    if (!text) return;
    setItems([...setlist.items, { id: newId(), songId: '', cue: text }]);
  };

  const editCue = async (it: SetlistItem) => {
    const text = (await askCue(it.cue ?? '', false))?.trim();
    if (!text) return;
    setItems(setlist.items.map((x) => (x.id === it.id ? { ...x, cue: text } : x)));
  };

  // Ändringar görs i hela listan, inte bara i de synliga punkterna: låtar som raderats eller
  // inte synkats än ska ligga kvar
  const setItems = (next: SetlistItem[]) => void saveSetlist({ ...setlist, items: next });

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((i) => i.id === e.active.id);
    const to = items.findIndex((i) => i.id === e.over!.id);
    setItems(moveVisible(setlist.items, items, from, to));
  };

  const play = (index: number) => {
    const it = items[index];
    if (it) navigate(itemPath(setlist.id, it, index));
  };

  return (
    <div className="screen">
      <Header title={setlist.name} back="/setlists">
        <button
          className="btn ghost icon"
          aria-label="Exportera setlistan"
          title="Exportera"
          disabled={!items.length}
          onClick={() => setExporting(true)}
        >
          <Share size={20} />
        </button>
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
              {nSongs} {nSongs === 1 ? 'låt' : 'låtar'}
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
                      number={numbers[idx]}
                      song={isCue(it) ? undefined : songs[it.songId]}
                      keyLabel={(() => {
                        const s = songs[it.songId];
                        if (isCue(it) || !s || s.attachment) return '';
                        // Som i låtlistan (H-notation och transponering), med setlistans egen tonart
                        const k = songKey(s, itemTranspose(it, s));
                        return k ? formatKey(k.key, 0, notation) : '';
                      })()}
                      onOpen={() => play(idx)}
                      onEdit={isCue(it) ? () => void editCue(it) : undefined}
                      onRemove={() => setItems(setlist.items.filter((x) => x.id !== it.id))}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => setAdding(true)}>
              <Plus size={18} /> Lägg till låtar
            </button>
            <button className="btn" onClick={() => void addCue()}>
              <MessageSquareText size={18} /> Lägg till text
            </button>
          </div>
        </div>
      </div>

      {adding && (
        <AddSongsSheet
          existing={new Set(items.filter((i) => !isCue(i)).map((i) => i.songId))}
          onClose={() => setAdding(false)}
          onAdd={(ids) => {
            setItems([...setlist.items, ...ids.map((songId) => ({ id: newId(), songId }))]);
            setAdding(false);
            toast(`${ids.length} ${ids.length === 1 ? 'låt' : 'låtar'} tillagda`);
          }}
        />
      )}

      {exporting && <ExportSheet setlistId={setlist.id} onClose={() => setExporting(false)} />}

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
              items: items.map((i) => ({ ...i, id: newId() })),
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
  number,
  song,
  keyLabel,
  onOpen,
  onEdit,
  onRemove,
}: {
  item: SetlistItem;
  /** 0 för mellanpunkter */
  number: number;
  song?: Song;
  keyLabel: string;
  onOpen: () => void;
  onEdit?: () => void;
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
      <span className="num">{number || <MessageSquareText size={16} aria-label="Text" />}</span>
      <div className="main" style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onOpen}>
        <div
          className={`title${song ? '' : ' cue-title'}`}
          style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {song ? song.title : item.cue}
        </div>
        {song?.artist && <div className="muted small-text">{song.artist}</div>}
      </div>
      {keyLabel && <span className="key-badge">{keyLabel}</span>}
      {onEdit && (
        <button className="btn ghost icon" aria-label="Ändra texten" onClick={onEdit}>
          <Pencil size={16} />
        </button>
      )}
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
  const [tags, setTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const tagList = useMemo(() => allTags(songsRec), [songsRec]);
  // Valda taggar först, så att de syns utan att man behöver svepa
  const tagRow = useMemo(() => [...tags, ...tagList.filter((t) => !tags.includes(t))], [tags, tagList]);
  const list = useMemo(
    () => sortSongs(filterSongs(liveSongs(songsRec), { query, fullText: false, tags }), 'title'),
    [songsRec, query, tags],
  );
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleTag = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const allVisibleSelected = list.length > 0 && list.every((s) => selected.includes(s.id));
  const selectAllVisible = () =>
    setSelected((cur) =>
      allVisibleSelected
        ? cur.filter((id) => !list.some((s) => s.id === id))
        : [...cur, ...list.map((s) => s.id).filter((id) => !cur.includes(id))],
    );

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
      {tagList.length > 0 && (
        <div className="chips scroll" style={{ marginBottom: 8 }} aria-label="Filtrera på taggar">
          {tags.length > 0 && (
            <button className="chip" onClick={() => setTags([])} aria-label="Rensa taggar">
              <X size={14} /> Rensa
            </button>
          )}
          {tagRow.map((t) => (
            <button
              key={t}
              className={`chip${tags.includes(t) ? ' on' : ''}`}
              style={{ flexShrink: 0 }}
              aria-pressed={tags.includes(t)}
              onClick={() => toggleTag(t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      {list.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 2px 4px' }}>
          <span className="muted small-text">
            {list.length} låtar{tags.length || query ? ' matchar' : ''}
          </span>
          <button className="btn small ghost" onClick={selectAllVisible}>
            {allVisibleSelected ? 'Avmarkera alla' : 'Välj alla'}
          </button>
        </div>
      )}
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

const MAIL_MESSAGES: Record<MailOutcome, string> = {
  sent: 'Mejlet är skickat',
  saved: 'Mejlet är sparat som utkast',
  cancelled: '',
  shared: 'Filerna är delade',
  downloaded: 'Filerna är nedladdade – bifoga dem i mejlet som öppnades',
};

function ExportSheet({ setlistId, onClose }: { setlistId: string; onClose: () => void }) {
  const setlist = useStore((s) => s.setlists[setlistId]);
  const songs = useStore((s) => s.songs);
  const notation = useStore((s) => s.settings.notation);
  const recentEmails = useStore((s) => s.settings.recentEmails);
  const updateSettings = useStore((s) => s.updateSettings);
  const [mode, setMode] = useState<'file' | 'mail'>('file');
  const [format, setFormat] = useState<SetlistExportFormat>('pdf-annotated');
  const [to, setTo] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  /** Webben: färdiga filer som väntar på att delas med ett nytt tryck */
  const [prepared, setPrepared] = useState<MailRequest | null>(null);

  const finish = (outcome: MailOutcome) => {
    if (MAIL_MESSAGES[outcome]) toast(MAIL_MESSAGES[outcome]);
    if (outcome !== 'cancelled') onClose();
  };

  const fail = (e: unknown) => {
    // Användaren stängde delningsmenyn
    if ((e as Error)?.message?.toLowerCase().includes('cancel')) return;
    toastError(e, mode === 'mail' ? 'Mejlet kunde inte skapas' : 'Exporten misslyckades');
  };

  const run = async () => {
    setBusy(true);
    try {
      if (mode === 'file') {
        await exportSetlist(format, setlist, songs, notation);
        onClose();
        return;
      }
      const files = await buildSongFiles(format, setlist, songs, notation);
      void updateSettings({ recentEmails: rememberEmails(recentEmails, to) });
      const req: MailRequest = { to, subject: mailSubject(setlist), body: mailBody(setlist, songs, notation), files };
      if (canComposeNatively()) finish(await composeNativeMail(req));
      else setPrepared(req);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const webAction = async (action: (r: MailRequest) => Promise<MailOutcome>) => {
    if (!prepared) return;
    try {
      finish(await action(prepared));
    } catch (e) {
      fail(e);
    }
  };

  // Webben, steg 2: dela med ett eget tryck (Safari kräver det) och kopiera mottagarna
  if (prepared) {
    const shareable = canShareFiles(prepared.files);
    return (
      <Sheet
        title="Mejlet är klart"
        onClose={onClose}
        footer={
          <button className="btn" onClick={() => setPrepared(null)}>
            Tillbaka
          </button>
        }
      >
        <p style={{ marginTop: 0 }}>
          {prepared.files.length} {prepared.files.length === 1 ? 'fil' : 'filer'} till {prepared.to.join(', ')}.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shareable && (
            <>
              <button className="btn primary" onClick={() => webAction(shareFilesWeb)}>
                Dela till Mail
              </button>
              <p className="muted small-text" style={{ margin: 0 }}>
                Välj Mail i delningsmenyn. Mottagarna kopieras när du trycker, så att du kan klistra in dem i
                Till-fältet. I webbläsaren går det inte att fylla i mottagare när filer bifogas – det gör iOS-appen.
              </p>
            </>
          )}
          <button
            className={`btn${shareable ? '' : ' primary'}`}
            onClick={() => webAction(downloadAndOpenMail)}
          >
            Ladda ner filerna och öppna mejl
          </button>
          <p className="muted small-text" style={{ margin: 0 }}>
            Mejlet öppnas med mottagare, ämne och setlistan ifyllda. Bifoga sedan de nedladdade filerna.
          </p>
        </div>
      </Sheet>
    );
  }

  const canRun = mode === 'file' || to.length > 0;

  return (
    <Sheet
      title="Exportera setlistan"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Avbryt
          </button>
          <button className="btn primary" disabled={busy || !canRun} onClick={run}>
            {busy ? 'Skapar…' : mode === 'mail' ? 'Skapa mejl' : 'Exportera'}
          </button>
        </>
      }
    >
      <div style={{ marginBottom: 12 }}>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'file', label: 'Spara fil' },
            { value: 'mail', label: 'Skicka med e-post' },
          ]}
        />
      </div>

      {mode === 'mail' && (
        <div className="field">
          <span>Mottagare</span>
          <EmailInput value={to} onChange={setTo} suggestions={recentEmails ?? []} />
        </div>
      )}

      {EXPORT_FORMATS.map((f) => (
        <label key={f.value} className="check-item">
          <input type="radio" name="export-format" checked={format === f.value} onChange={() => setFormat(f.value)} />
          <div>
            <div style={{ fontWeight: 600 }}>{f.label}</div>
            <div className="muted small-text">{f.description}</div>
          </div>
        </label>
      ))}
      <p className="muted small-text" style={{ marginBottom: 0 }}>
        {mode === 'mail'
          ? 'Varje låt bifogas som en egen fil. Hela setlistan med titel och artist står i mejlet. '
          : ''}
        Ackorden exporteras med låtarnas transponering, precis som de visas i appen.
      </p>
    </Sheet>
  );
}
