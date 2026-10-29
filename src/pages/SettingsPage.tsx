import { useEffect, useMemo, useState } from 'react';
import { Cloud, CloudUpload, Download, FileArchive, Pencil, Plus, RefreshCw, Trash, Upload } from 'lucide-react';
import { askText, Header, Segmented, Sheet, Switch, toast, toastError } from '../components/ui';
import type { Instrument } from '../lib/chordShapes';
import { ACCENT_COLORS, type BackupFile, type Theme } from '../lib/model';
import type { Notation } from '../lib/chords';
import { hasNativePlugin } from '../native/songlistNative';
import {
  createICloudBackup,
  deleteICloudBackup,
  exportBackupFile,
  listICloudBackups,
  parseBackup,
  readICloudBackup,
  restoreBackup,
  type ICloudBackup,
  type RestoreMode,
} from '../services/backup';
import { exportSongsZip } from '../services/songFiles';
import { pickFiles } from '../services/files';
import { iCloudAvailable, syncNow } from '../services/sync';
import { liveCategories, liveSongs, useStore } from '../store/useStore';

function formatTime(ts?: number): string {
  if (!ts) return 'aldrig';
  return new Date(ts).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' });
}

export function SettingsPage() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const songsRec = useStore((s) => s.songs);
  const songCount = useMemo(() => liveSongs(songsRec).length, [songsRec]);

  return (
    <div className="screen">
      <Header title="Inställningar" />
      <div className="content narrow">
        <div>
          <div className="section-title">Visning</div>
          <div className="card">
            <div className="toggle-row choice-row">
              <span>Ackorddiagram för</span>
              <Segmented<Instrument>
                value={settings.instrument}
                onChange={(v) => update({ instrument: v })}
                options={[
                  { value: 'guitar', label: 'Gitarr' },
                  { value: 'ukulele', label: 'Ukulele' },
                  { value: 'piano', label: 'Piano' },
                ]}
              />
            </div>
            <div className="toggle-row choice-row">
              <div>
                <div>Notation</div>
                <div className="muted small-text">Svensk notation skriver H istället för B, och B istället för Bb</div>
              </div>
              <Segmented<Notation>
                value={settings.notation}
                onChange={(v) => update({ notation: v })}
                options={[
                  { value: 'international', label: 'B' },
                  { value: 'swedish', label: 'H' },
                ]}
              />
            </div>
            <div className="toggle-row choice-row">
              <span>Utseende</span>
              <Segmented<Theme>
                value={settings.theme}
                onChange={(v) => update({ theme: v })}
                options={[
                  { value: 'system', label: 'Auto' },
                  { value: 'light', label: 'Ljust' },
                  { value: 'dark', label: 'Mörkt' },
                ]}
              />
            </div>
            <div className="toggle-row choice-row">
              <span>Färgtema</span>
              <div className="accent-swatches" role="radiogroup" aria-label="Färgtema">
                {ACCENT_COLORS.map((c) => {
                  const on = (settings.accent ?? 'green') === c.value;
                  return (
                    <button
                      key={c.value}
                      role="radio"
                      aria-checked={on}
                      aria-label={c.label}
                      title={c.label}
                      className={`accent-swatch${on ? ' on' : ''}`}
                      style={{ background: c.swatch }}
                      onClick={() => update({ accent: c.value })}
                    />
                  );
                })}
              </div>
            </div>
            <div className="toggle-row">
              <span>Visa ackorddiagram ovanför låten</span>
              <Switch label="Visa ackorddiagram" checked={settings.showDiagrams} onChange={(v) => update({ showDiagrams: v })} />
            </div>
            <div className="toggle-row">
              <div>
                <div>Två spalter i liggande läge</div>
                <div className="muted small-text">På en bred skärm, när låten då får plats utan att scrolla (texten görs mindre vid behov)</div>
              </div>
              <Switch label="Två spalter" checked={settings.twoColumns !== false} onChange={(v) => update({ twoColumns: v })} />
            </div>
            <div className="toggle-row">
              <div>
                <div>Bläddra PDF:er i sidled</div>
                <div className="muted small-text">En sida i taget som man sveper mellan, i stället för att scrolla nedåt</div>
              </div>
              <Switch label="Bläddra PDF:er i sidled" checked={settings.filePaging !== false} onChange={(v) => update({ filePaging: v })} />
            </div>
            <div className="toggle-row">
              <div>
                <div>Förenklade ackord</div>
                <div className="muted small-text">Visar t.ex. Cmaj7, Dsus4 och G/B som C, D och G. Låtarna ändras inte.</div>
              </div>
              <Switch label="Förenklade ackord" checked={!!settings.simplifyChords} onChange={(v) => update({ simplifyChords: v })} />
            </div>
            <div className="toggle-row">
              <span>Textstorlek</span>
              <div className="tool-group">
                <button className="btn icon" onClick={() => update({ fontSize: Math.max(12, settings.fontSize - 2) })}>
                  −
                </button>
                <span className="tool-value">{settings.fontSize}</span>
                <button className="btn icon" onClick={() => update({ fontSize: Math.min(44, settings.fontSize + 2) })}>
                  +
                </button>
              </div>
            </div>
          </div>

          <div className="section-title">Kategorier</div>
          <CategoriesCard />

          <div className="section-title">Säkerhetskopiering och synk</div>
          {hasNativePlugin() ? <ICloudCard /> : null}
          <FileBackupCard />

          <p className="muted small-text" style={{ textAlign: 'center', marginTop: 24 }}>
            SongList · {songCount} {songCount === 1 ? 'låt' : 'låtar'} sparade lokalt på den här enheten
          </p>
        </div>
      </div>
    </div>
  );
}

function CategoriesCard() {
  const categoriesRec = useStore((s) => s.categories);
  const songsRec = useStore((s) => s.songs);
  const saveCategory = useStore((s) => s.saveCategory);
  const deleteCategory = useStore((s) => s.deleteCategory);
  const categories = useMemo(() => liveCategories(categoriesRec), [categoriesRec]);
  const [name, setName] = useState('');

  const count = (id: string) => liveSongs(songsRec).filter((s) => s.categoryId === id).length;

  const add = async () => {
    if (!name.trim()) return;
    if (categories.some((c) => c.name.toLowerCase() === name.trim().toLowerCase())) {
      toast('Kategorin finns redan', { error: true });
      return;
    }
    await saveCategory({ name });
    setName('');
  };

  return (
    <div className="card">
      <p className="muted small-text" style={{ marginTop: 0 }}>
        Varje låt kan ha en kategori (t.ex. Psalmer, Barnvisor, Pop) och flera taggar.
      </p>
      {categories.map((c) => (
        <div className="toggle-row" key={c.id}>
          <span>
            {c.name} <span className="muted small-text">({count(c.id)})</span>
          </span>
          <div className="btn-row">
            <button
              className="btn ghost icon"
              aria-label={`Byt namn på ${c.name}`}
              onClick={async () => {
                const n = await askText({ title: 'Byt namn på kategorin', label: 'Namn', initial: c.name, confirmLabel: 'Spara' });
                if (n) await saveCategory({ id: c.id, name: n });
              }}
            >
              <Pencil size={18} />
            </button>
            <button
              className="btn ghost icon danger"
              aria-label={`Radera ${c.name}`}
              onClick={async () => {
                if (confirm(`Radera kategorin "${c.name}"? Låtarna finns kvar.`)) await deleteCategory(c.id);
              }}
            >
              <Trash size={18} />
            </button>
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          className="input"
          placeholder="Ny kategori"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn" disabled={!name.trim()} onClick={add}>
          <Plus size={18} /> Lägg till
        </button>
      </div>
    </div>
  );
}

function ICloudCard() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backups, setBackups] = useState<ICloudBackup[] | null>(null);
  const [restore, setRestore] = useState<{ data: BackupFile; name: string } | null>(null);

  useEffect(() => {
    void iCloudAvailable().then(setAvailable);
  }, []);

  const doSync = async () => {
    setSyncing(true);
    try {
      const r = await syncNow();
      toast(
        r.devices === 0
          ? 'Synkat. Inga andra enheter har synkat ännu.'
          : `Synkat med ${r.devices} ${r.devices === 1 ? 'enhet' : 'enheter'} · ${r.received} ändringar hämtade`,
      );
    } catch (e) {
      toastError(e, 'Synken misslyckades');
    } finally {
      setSyncing(false);
    }
  };

  const doBackup = async () => {
    setBackingUp(true);
    try {
      const name = await createICloudBackup();
      toast(`Sparat i iCloud Drive: ${name}`);
      if (backups) setBackups(await listICloudBackups());
    } catch (e) {
      toastError(e, 'Backup misslyckades');
    } finally {
      setBackingUp(false);
    }
  };

  const showBackups = async () => {
    try {
      setBackups(await listICloudBackups());
    } catch (e) {
      toastError(e, 'Kunde inte lista säkerhetskopior');
    }
  };

  if (available === false) {
    return (
      <div className="card">
        <h2>
          <Cloud size={18} style={{ verticalAlign: -3 }} /> iCloud
        </h2>
        <p className="muted small-text" style={{ margin: 0 }}>
          iCloud är inte tillgängligt. Logga in på iCloud och slå på iCloud Drive i Inställningar på enheten för att
          kunna säkerhetskopiera och synka mellan iPhone och iPad.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>
        <Cloud size={18} style={{ verticalAlign: -3 }} /> iCloud
      </h2>
      <div className="toggle-row">
        <div>
          <div>Synka mellan enheter</div>
          <div className="muted small-text">
            Låtar, setlistor och kategorier synkas med dina andra enheter via iCloud. Senast: {formatTime(settings.lastSyncAt)}
          </div>
        </div>
        <Switch label="Synka automatiskt" checked={settings.autoSync} onChange={(v) => update({ autoSync: v })} />
      </div>
      <div className="toggle-row">
        <div>
          <div>Automatisk backup varje vecka</div>
          <div className="muted small-text">
            De tio senaste sparas i iCloud Drive › SongList. Varje låt sparas också som en egen fil (ChordPro, PDF eller
            bild) i mappen Låtar. Senast: {formatTime(settings.lastBackupAt)}
          </div>
        </div>
        <Switch label="Automatisk backup" checked={settings.autoBackup} onChange={(v) => update({ autoBackup: v })} />
      </div>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn" disabled={syncing || !available} onClick={doSync}>
          <RefreshCw size={18} className={syncing ? 'spin' : ''} /> Synka nu
        </button>
        <button className="btn" disabled={backingUp || !available} onClick={doBackup}>
          <CloudUpload size={18} /> Säkerhetskopiera nu
        </button>
        <button className="btn" disabled={!available} onClick={showBackups}>
          Återställ…
        </button>
      </div>

      {backups && (
        <Sheet title="Säkerhetskopior i iCloud" onClose={() => setBackups(null)}>
          {backups.length === 0 && <p className="muted">Inga säkerhetskopior hittades.</p>}
          <div className="list">
            {backups.map((b) => (
              <div key={b.name} className="list-item">
                <div
                  className="main"
                  onClick={async () => {
                    try {
                      setRestore({ data: await readICloudBackup(b.name), name: b.name });
                    } catch (e) {
                      toastError(e, 'Kunde inte läsa säkerhetskopian');
                    }
                  }}
                >
                  <div className="title">{b.name.replace(/\.json$/, '')}</div>
                  {b.size > 0 && <div className="sub">{Math.max(1, Math.round(b.size / 1024))} kB</div>}
                </div>
                <button
                  className="btn ghost icon danger"
                  aria-label="Radera säkerhetskopia"
                  onClick={async () => {
                    if (!confirm(`Radera ${b.name}?`)) return;
                    try {
                      await deleteICloudBackup(b.name);
                      setBackups(await listICloudBackups());
                    } catch (e) {
                      toastError(e);
                    }
                  }}
                >
                  <Trash size={18} />
                </button>
              </div>
            ))}
          </div>
        </Sheet>
      )}

      {restore && (
        <RestoreSheet
          data={restore.data}
          name={restore.name}
          onClose={() => setRestore(null)}
          onDone={() => {
            setRestore(null);
            setBackups(null);
          }}
        />
      )}
    </div>
  );
}

function FileBackupCard() {
  const [restore, setRestore] = useState<{ data: BackupFile; name: string } | null>(null);

  const importFile = async () => {
    const [file] = await pickFiles({ accept: '.json,application/json' });
    if (!file) return;
    try {
      setRestore({ data: parseBackup(await file.text()), name: file.name });
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="card">
      <h2>Fil</h2>
      <p className="muted small-text" style={{ marginTop: 0 }}>
        Spara hela biblioteket som en fil, t.ex. för att flytta det till en annan enhet eller spara det på en dator.
        Alla låtar som filer ger en zip-fil med en ChordPro-fil per låt (och PDF:er och bilder), som andra appar kan
        läsa.
      </p>
      <div className="btn-row">
        <button
          className="btn"
          onClick={() => exportBackupFile().catch((e) => toastError(e, 'Exporten misslyckades'))}
        >
          <Download size={18} /> Exportera backupfil
        </button>
        <button
          className="btn"
          onClick={() =>
            exportSongsZip()
              .then((n) => toast(`${n} ${n === 1 ? 'låt' : 'låtar'} exporterade`))
              .catch((e) => toastError(e, 'Exporten misslyckades'))
          }
        >
          <FileArchive size={18} /> Alla låtar som filer
        </button>
        <button className="btn" onClick={importFile}>
          <Upload size={18} /> Återställ från fil
        </button>
      </div>
      {restore && (
        <RestoreSheet data={restore.data} name={restore.name} onClose={() => setRestore(null)} onDone={() => setRestore(null)} />
      )}
    </div>
  );
}

function RestoreSheet({
  data,
  name,
  onClose,
  onDone,
}: {
  data: BackupFile;
  name: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [busy, setBusy] = useState(false);
  const songs = data.songs.filter((s) => !s.deletedAt).length;
  const setlists = data.setlists.filter((s) => !s.deletedAt).length;

  const run = async () => {
    if (mode === 'replace' && !confirm('Ersätta hela biblioteket? Låtar som inte finns i säkerhetskopian raderas.')) return;
    setBusy(true);
    try {
      const n = await restoreBackup(data, mode);
      toast(`Återställt ${n} ${n === 1 ? 'låt' : 'låtar'}`);
      onDone();
    } catch (e) {
      toastError(e, 'Återställningen misslyckades');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Återställ säkerhetskopia"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Avbryt
          </button>
          <button className={`btn primary${mode === 'replace' ? ' danger' : ''}`} disabled={busy} onClick={run}>
            Återställ
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        <b>{name.replace(/\.json$/, '')}</b>
        <br />
        <span className="muted small-text">
          {songs} låtar · {setlists} setlistor · skapad {formatTime(data.createdAt)}
        </span>
      </p>
      <label className="check-item">
        <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
        <div>
          <div style={{ fontWeight: 600 }}>Slå ihop</div>
          <div className="muted small-text">Lägger till låtar som saknas. Dina nyare ändringar behålls.</div>
        </div>
      </label>
      <label className="check-item">
        <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
        <div>
          <div style={{ fontWeight: 600 }}>Ersätt allt</div>
          <div className="muted small-text">Biblioteket blir exakt som i säkerhetskopian.</div>
        </div>
      </label>
    </Sheet>
  );
}
