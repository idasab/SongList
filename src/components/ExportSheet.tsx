import { useState } from 'react';
import { Segmented, Sheet, toast, toastError } from './ui';
import { EmailInput, rememberEmails } from './EmailInput';
import { EXPORT_FORMATS, buildSongFiles, mailBody, mailSubject, type ExportFile, type SetlistExportFormat } from '../services/setlistExport';
import {
  canComposeNatively,
  composeNativeMail,
  downloadAndOpenMail,
  shareFilesWeb,
  type MailOutcome,
  type MailRequest,
} from '../services/mail';
import { canShareFiles, saveFiles, shareFilesInBrowser } from '../services/files';
import { isNative } from '../native/songlistNative';
import type { Setlist } from '../lib/model';
import { useStore } from '../store/useStore';

const MAIL_MESSAGES: Record<MailOutcome, string> = {
  sent: 'Mejlet är skickat',
  saved: 'Mejlet är sparat som utkast',
  cancelled: '',
  shared: 'Filerna är delade',
  downloaded: 'Filerna är nedladdade – bifoga dem i mejlet som öppnades',
};

/** Webben: färdiga filer som väntar på ett nytt tryck (Safari delar bara direkt från ett tryck) */
type Prepared = { kind: 'mail'; req: MailRequest } | { kind: 'files'; files: ExportFile[] };

/**
 * Exportera eller dela låtar, en fil per låt (låtar som är bilder eller PDF:er blir originalfilen).
 * Låtarna är en setlista, eller (songs) låtar som valts i biblioteket: då numreras filerna inte
 * och det finns ingen SongList-fil.
 */
export function ExportSheet({ setlist, songs: selection, onClose }: { setlist: Setlist; songs?: boolean; onClose: () => void }) {
  const songs = useStore((s) => s.songs);
  const notation = useStore((s) => s.settings.notation);
  const recentEmails = useStore((s) => s.settings.recentEmails);
  const updateSettings = useStore((s) => s.updateSettings);
  const [mode, setMode] = useState<'file' | 'mail'>('file');
  const [format, setFormat] = useState<SetlistExportFormat>('pdf-annotated');
  const [to, setTo] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const formats = selection ? EXPORT_FORMATS.filter((f) => f.value !== 'songlist') : EXPORT_FORMATS;

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
      const files = await buildSongFiles(format, setlist, songs, notation, { numbered: !selection });
      if (!files.length) {
        toast('Det finns inga låtar att exportera', { error: true });
        return;
      }
      if (mode === 'file') {
        // Webben: delningsmenyn kräver ett nytt tryck; går det inte laddas filerna ner
        if (!isNative && canShareFiles(files)) return setPrepared({ kind: 'files', files });
        await saveFiles(files);
        onClose();
        return;
      }
      void updateSettings({ recentEmails: rememberEmails(recentEmails, to) });
      const req: MailRequest = { to, subject: mailSubject(setlist), body: mailBody(setlist, songs, notation, format), files };
      if (canComposeNatively()) finish(await composeNativeMail(req));
      else setPrepared({ kind: 'mail', req });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const webAction = async (action: () => Promise<MailOutcome>) => {
    try {
      finish(await action());
    } catch (e) {
      fail(e);
    }
  };

  // Webben, steg 2: dela filerna med ett eget tryck
  if (prepared?.kind === 'files') {
    const { files } = prepared;
    return (
      <Sheet
        title="Filerna är klara"
        onClose={onClose}
        footer={
          <button className="btn" onClick={() => setPrepared(null)}>
            Tillbaka
          </button>
        }
      >
        <p style={{ marginTop: 0 }}>
          {files.length} {files.length === 1 ? 'fil' : 'filer'}, en för varje låt.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="btn primary" onClick={() => webAction(async () => ((await shareFilesInBrowser(files)) ? 'shared' : 'cancelled'))}>
            Dela
          </button>
          <button
            className="btn"
            onClick={async () => {
              try {
                await saveFiles(files);
                onClose();
              } catch (e) {
                fail(e);
              }
            }}
          >
            Ladda ner
          </button>
        </div>
      </Sheet>
    );
  }

  // Webben, steg 2: dela med ett eget tryck (Safari kräver det) och kopiera mottagarna
  if (prepared?.kind === 'mail') {
    const { req } = prepared;
    const shareable = canShareFiles(req.files);
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
          {req.files.length} {req.files.length === 1 ? 'fil' : 'filer'} till {req.to.join(', ')}.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shareable && (
            <>
              <button className="btn primary" onClick={() => webAction(() => shareFilesWeb(req))}>
                Dela till Mail
              </button>
              <p className="muted small-text" style={{ margin: 0 }}>
                Välj Mail i delningsmenyn. Mottagarna kopieras när du trycker, så att du kan klistra in dem i
                Till-fältet. I webbläsaren går det inte att fylla i mottagare när filer bifogas – det gör iOS-appen.
              </p>
            </>
          )}
          <button className={`btn${shareable ? '' : ' primary'}`} onClick={() => webAction(() => downloadAndOpenMail(req))}>
            Ladda ner filerna och öppna mejl
          </button>
          <p className="muted small-text" style={{ margin: 0 }}>
            Mejlet öppnas med mottagare, ämne och {selection ? 'låtarna' : 'setlistan'} ifyllda. Bifoga sedan de nedladdade filerna.
          </p>
        </div>
      </Sheet>
    );
  }

  const canRun = mode === 'file' || to.length > 0;

  return (
    <Sheet
      title={selection ? 'Dela låtarna' : 'Exportera setlistan'}
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
            { value: 'file', label: 'Spara eller dela' },
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

      {formats.map((f) => (
        <label key={f.value} className="check-item">
          <input type="radio" name="export-format" checked={format === f.value} onChange={() => setFormat(f.value)} />
          <div>
            <div style={{ fontWeight: 600 }}>{f.label}</div>
            <div className="muted small-text">{f.description}</div>
          </div>
        </label>
      ))}
      <p className="muted small-text" style={{ marginBottom: 0 }}>
        {format === 'songlist'
          ? 'Setlistan och alla låtar i en fil. '
          : 'Varje låt blir en egen fil. Låtar som är sparade som bild eller PDF följer med som originalfilen. '}
        {mode === 'mail' && format !== 'songlist' ? `${selection ? 'Låtarna' : 'Hela setlistan'} med titel och artist står i mejlet. ` : ''}
        Ackorden exporteras med låtarnas transponering, precis som de visas i appen.
      </p>
    </Sheet>
  );
}
