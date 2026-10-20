import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ListMusic, Plus } from 'lucide-react';
import { Header, Sheet } from '../components/ui';
import { liveSetlists, useStore } from '../store/useStore';

export function SetlistsPage() {
  const navigate = useNavigate();
  const setlistsRec = useStore((s) => s.setlists);
  const songs = useStore((s) => s.songs);
  const saveSetlist = useStore((s) => s.saveSetlist);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');

  const setlists = useMemo(
    () =>
      liveSetlists(setlistsRec).sort(
        (a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.updatedAt - a.updatedAt,
      ),
    [setlistsRec],
  );

  const create = async () => {
    if (!name.trim()) return;
    const sl = await saveSetlist({ name: name.trim(), date: date || undefined, items: [] });
    setCreating(false);
    setName('');
    setDate('');
    navigate(`/setlists/${sl.id}`);
  };

  return (
    <div className="screen">
      <Header title="Setlistor">
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={18} /> <span className="hide-mobile">Ny setlista</span>
        </button>
      </Header>
      <div className="content narrow">
        <div>
          {setlists.length === 0 ? (
            <div className="empty">
              <ListMusic size={48} />
              <p>Inga setlistor ännu.</p>
              <button className="btn primary" onClick={() => setCreating(true)}>
                Skapa setlista
              </button>
            </div>
          ) : (
            <div className="list">
              {setlists.map((sl) => {
                const count = sl.items.filter((i) => songs[i.songId] && !songs[i.songId].deletedAt).length;
                return (
                  <Link key={sl.id} className="list-item" to={`/setlists/${sl.id}`}>
                    <div className="main">
                      <div className="title">{sl.name}</div>
                      <div className="sub">
                        {sl.date ? formatDate(sl.date) + ' · ' : ''}
                        {count} {count === 1 ? 'låt' : 'låtar'}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {creating && (
        <Sheet
          title="Ny setlista"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn" onClick={() => setCreating(false)}>
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
        </Sheet>
      )}
    </div>
  );
}

export function formatDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
}
