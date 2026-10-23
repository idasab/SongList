import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupFile, Song } from '../lib/model';

// --- Låtsad iCloud Drive som beter sig som den inbyggda iOS-koden ---
// Filer sparas som bytes. base64: true vid skrivning avkodar data, och vid läsning ges bytes
// base64-kodade; annars är det UTF-8-text. Mappar syns i fillistorna, som i iOS.

interface FakeFile {
  bytes: Uint8Array;
  modifiedAt: number;
  unreadable?: boolean;
  /** Finns bara i molnet (platshållare) */
  inCloud?: boolean;
}
const fs = new Map<string, FakeFile>();
const native = { available: true, writes: [] as string[] };

const b64ToBytes = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const bytesToB64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

vi.mock('../native/songlistNative', () => ({
  hasNativePlugin: () => native.available,
  SongListNative: {
    iCloudStatus: async () => ({ available: true, signedIn: true }),
    writeFile: async ({ path, data, base64 }: { path: string; data: string; base64?: boolean }) => {
      if (base64 && !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Ogiltig base64-data');
      native.writes.push(path);
      fs.set(path, { bytes: base64 ? b64ToBytes(data) : new TextEncoder().encode(data), modifiedAt: Date.now() });
    },
    readFile: async ({ path, base64 }: { path: string; base64?: boolean }) => {
      const f = fs.get(path);
      if (!f || f.unreadable) throw new Error('NOT_FOUND');
      return { data: base64 ? bytesToB64(f.bytes) : new TextDecoder().decode(f.bytes) };
    },
    deleteFile: async ({ path }: { path: string }) => void fs.delete(path),
    listFiles: async ({ path }: { path: string }) => {
      const names = new Map<string, FakeFile | null>();
      for (const [p, f] of fs) {
        if (!p.startsWith(path + '/')) continue;
        const rest = p.slice(path.length + 1);
        if (rest.startsWith('.')) continue; // dolda filer listas inte, som i iOS-koden
        const slash = rest.indexOf('/');
        if (slash < 0) names.set(rest, f);
        else names.set(rest.slice(0, slash), null); // undermapp
      }
      return {
        files: [...names].map(([name, f]) => ({
          name,
          modifiedAt: f?.modifiedAt ?? 0,
          size: f?.bytes.length ?? 0,
          downloaded: !f?.inCloud,
        })),
      };
    },
  },
}));

// Lokal lagring behövs inte i testet
vi.mock('../store/db', () => {
  const noop = async () => undefined;
  const table = { all: async () => [], put: noop, putMany: noop, clear: noop };
  return {
    requestPersistentStorage: noop,
    db: {
      songs: table,
      setlists: table,
      categories: table,
      folders: table,
      saveSettings: noop,
      getSettings: noop,
      getDeviceId: async () => 'test',
      isFirstRun: async () => false,
    },
  };
});

const { useStore, liveSongs } = await import('../store/useStore');
const backup = await import('./backup');
const { mirrorSongsToICloud } = await import('./songFiles');

// Små "PDF:er" och en "bild" med olika innehåll (inklusive bytes som inte är giltig UTF-8)
const bytes = (...b: number[]) => new Uint8Array(b);
const PDF1 = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x0a, 0xff, 0xfe, 0x00, 0x80);
const PDF2 = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x32, 0x0a, 0xc3, 0x28);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46);
const url = (mime: string, b: Uint8Array) => `data:${mime};base64,${bytesToB64(b)}`;

function song(id: string, title: string, file?: { b: Uint8Array; name: string; mime: string }): Song {
  return {
    id,
    title,
    artist: '',
    content: file ? `{title: ${title}}` : `{title: ${title}}\n[G]Hej [C]hå`,
    tags: [],
    transpose: 0,
    createdAt: 1,
    updatedAt: Date.now(),
    attachment: file
      ? { name: file.name, mime: file.mime, dataUrl: url(file.mime, file.b), kind: file.mime === 'application/pdf' ? 'pdf' : 'image' }
      : undefined,
  };
}

function setLibrary(songs: Song[]) {
  useStore.setState({ songs: Object.fromEntries(songs.map((s) => [s.id, s])), setlists: {}, categories: {}, folders: {} });
}

// Synliga filer direkt i mappen (dolda filer som förteckningen räknas inte)
const filesIn = (dir: string) =>
  [...fs.keys()].filter((p) => p.startsWith(dir + '/') && !p.slice(dir.length + 1).includes('/') && !p.slice(dir.length + 1).startsWith('.'));
const storedFiles = () => filesIn('Säkerhetskopior/Filer');
const DAY = 24 * 3600 * 1000;
let clock = new Date('2026-10-01T10:00:00').getTime();
const advance = (ms: number) => {
  clock += ms;
  vi.setSystemTime(clock);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock = new Date('2026-10-01T10:00:00').getTime();
  vi.setSystemTime(clock);
  fs.clear();
  native.available = true;
  native.writes = [];
  setLibrary([
    song('a', 'Noter A', { b: PDF1, name: 'Noter A.pdf', mime: 'application/pdf' }),
    song('b', 'Noter B', { b: PDF1, name: 'Kopia.PDF', mime: 'application/pdf' }),
    song('c', 'Bild', { b: JPG, name: 'foto.jpeg', mime: 'image/jpeg' }),
    song('d', 'Text'),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('säkerhetskopior i iCloud med originalfiler', () => {
  it('sparar varje fil en gång, byte för byte, och JSON-filen innehåller dem inte', async () => {
    const name = await backup.createICloudBackup();
    const stored = storedFiles();
    expect(stored).toHaveLength(2); // PDF1 i två låtar + bilden
    const contents = stored.map((p) => bytesToB64(fs.get(p)!.bytes)).sort();
    expect(contents).toEqual([bytesToB64(PDF1), bytesToB64(JPG)].sort());
    expect(stored.some((p) => p.endsWith('.pdf'))).toBe(true);
    expect(stored.some((p) => p.endsWith('.jpeg'))).toBe(true);

    const json = new TextDecoder().decode(fs.get(`Säkerhetskopior/${name}`)!.bytes);
    expect(json).not.toContain(bytesToB64(PDF1));
    expect(json).not.toContain(bytesToB64(JPG));
    const parsed = JSON.parse(json) as BackupFile;
    const a = parsed.songs.find((s) => s.id === 'a')!.attachment!;
    const b = parsed.songs.find((s) => s.id === 'b')!.attachment!;
    expect(a.dataUrl).toBe('');
    expect(a.file).toBe(b.file); // samma innehåll, samma fil
  });

  it('återställer exakt samma filer från iCloud', async () => {
    const name = await backup.createICloudBackup();
    const before = liveSongs(useStore.getState().songs).map((s) => [s.id, s.attachment?.dataUrl]);
    const data = await backup.readICloudBackup(name);
    for (const [id, dataUrl] of before) {
      const s = data.songs.find((x) => x.id === id)!;
      expect(s.attachment?.dataUrl).toBe(dataUrl);
      expect(s.attachment?.file).toBeUndefined();
    }
  });

  it('återställer biblioteket ("ersätt") med filerna efter att låtarna raderats', async () => {
    const name = await backup.createICloudBackup();
    const data = await backup.readICloudBackup(name);
    setLibrary([song('x', 'Annan låt')]);
    const n = await backup.restoreBackup(data, 'replace');
    expect(n).toBe(4);
    const live = liveSongs(useStore.getState().songs);
    expect(live.map((s) => s.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(live.find((s) => s.id === 'c')!.attachment!.dataUrl).toBe(url('image/jpeg', JPG));
  });

  it('hämtar filerna även när JSON-filen återställs via "Återställ från fil" i iOS-appen', async () => {
    const name = await backup.createICloudBackup();
    const raw = backup.parseBackup(new TextDecoder().decode(fs.get(`Säkerhetskopior/${name}`)!.bytes));
    expect(raw.songs.find((s) => s.id === 'a')!.attachment!.dataUrl).toBe('');
    setLibrary([]);
    await backup.restoreBackup(raw, 'merge');
    expect(useStore.getState().songs.a.attachment!.dataUrl).toBe(url('application/pdf', PDF1));
  });

  it('behåller låten med en anteckning när filen inte går att hämta (t.ex. i webbläsaren)', async () => {
    const name = await backup.createICloudBackup();
    const raw = backup.parseBackup(new TextDecoder().decode(fs.get(`Säkerhetskopior/${name}`)!.bytes));
    native.available = false;
    setLibrary([]);
    const n = await backup.restoreBackup(raw, 'merge');
    expect(n).toBe(4);
    const a = useStore.getState().songs.a;
    expect(a.attachment).toBeUndefined();
    expect(a.content).toContain('Originalfilen Noter A.pdf saknas');
    // Textlåten påverkas inte
    expect(useStore.getState().songs.d.content).toContain('[G]Hej');
  });

  it('läser äldre säkerhetskopior där filerna är inbäddade', async () => {
    const legacy: BackupFile = { ...backup.buildBackup() };
    fs.set('Säkerhetskopior/SongList 2025-01-01 10.00.json', {
      bytes: new TextEncoder().encode(JSON.stringify(legacy)),
      modifiedAt: Date.now(),
    });
    const data = await backup.readICloudBackup('SongList 2025-01-01 10.00.json');
    expect(data.songs.find((s) => s.id === 'a')!.attachment!.dataUrl).toBe(url('application/pdf', PDF1));
  });

  it('återanvänder befintliga filer i nästa säkerhetskopia', async () => {
    await backup.createICloudBackup();
    native.writes = [];
    advance(60_000);
    await backup.createICloudBackup();
    expect(native.writes.filter((p) => p.startsWith('Säkerhetskopior/Filer/'))).toHaveLength(0);
  });

  it('raderar en fil först när ingen säkerhetskopia pekar på den, och tidigast efter ett dygn', async () => {
    const first = await backup.createICloudBackup();
    // Byt notblad i låt a och gör en ny säkerhetskopia
    advance(2 * DAY);
    setLibrary([
      song('a', 'Noter A', { b: PDF2, name: 'Noter A.pdf', mime: 'application/pdf' }),
      song('c', 'Bild', { b: JPG, name: 'foto.jpeg', mime: 'image/jpeg' }),
    ]);
    const second = await backup.createICloudBackup();
    expect(storedFiles()).toHaveLength(3); // PDF1 behövs fortfarande av den första

    // Den första raderas: PDF1 är gammal och används inte längre
    await backup.deleteICloudBackup(first);
    const left = storedFiles().map((p) => bytesToB64(fs.get(p)!.bytes)).sort();
    expect(left).toEqual([bytesToB64(PDF2), bytesToB64(JPG)].sort());

    // Den andra raderas direkt: PDF2 är nyare än ett dygn och får vara kvar
    await backup.deleteICloudBackup(second);
    expect(storedFiles().map((p) => bytesToB64(fs.get(p)!.bytes))).toContain(bytesToB64(PDF2));
    advance(2 * DAY);
    setLibrary([song('d', 'Text')]); // ingen låt använder PDF2 längre
    await backup.createICloudBackup(); // rensar igen
    expect(storedFiles().map((p) => bytesToB64(fs.get(p)!.bytes))).not.toContain(bytesToB64(PDF2));
  });

  it('tar inte bort något om en säkerhetskopia inte går att läsa', async () => {
    const first = await backup.createICloudBackup();
    advance(2 * DAY);
    setLibrary([song('d', 'Text')]);
    await backup.createICloudBackup();
    fs.get(`Säkerhetskopior/${first}`)!.unreadable = true;
    advance(2 * DAY);
    await backup.createICloudBackup();
    expect(storedFiles()).toHaveLength(2);
  });

  it('väntar med att rensa tills alla säkerhetskopior är nedladdade', async () => {
    const first = await backup.createICloudBackup();
    advance(2 * DAY);
    setLibrary([song('d', 'Text')]);
    await backup.createICloudBackup();
    // En säkerhetskopia från en annan enhet finns bara i molnet än
    fs.set('Säkerhetskopior/Från iPad.json', { bytes: new TextEncoder().encode('{}'), modifiedAt: 0, inCloud: true });
    // Den första raderas; dess filer rensas inte medan den andra inte är nedladdad
    await backup.deleteICloudBackup(first);
    expect(storedFiles()).toHaveLength(2);
    advance(2 * DAY);
    await backup.createICloudBackup();
    expect(storedFiles()).toHaveLength(2);
    // När den är nedladdad rensas de
    fs.delete('Säkerhetskopior/Från iPad.json');
    advance(60_000);
    await backup.createICloudBackup();
    expect(storedFiles()).toHaveLength(0);
  });

  it('veckobackuperna roterar, och filer som de kvarvarande behöver finns kvar', async () => {
    const versions: Uint8Array[] = [];
    for (let i = 0; i < 13; i++) {
      const pdf = bytes(0x25, 0x50, 0x44, 0x46, i, 0xff);
      versions.push(pdf);
      setLibrary([song('a', 'Noter A', { b: pdf, name: 'Noter A.pdf', mime: 'application/pdf' })]);
      useStore.setState({ settings: { ...useStore.getState().settings, autoBackup: true, lastBackupAt: undefined } });
      await backup.autoBackupIfDue();
      advance(8 * DAY);
    }
    await backup.createICloudBackup(); // rensar efter de sista
    const autos = (await backup.listICloudBackups()).filter((b) => b.name.startsWith('Auto '));
    expect(autos).toHaveLength(10);
    const left = new Set(storedFiles().map((p) => bytesToB64(fs.get(p)!.bytes)));
    // De tre äldsta har roterats bort tillsammans med sina filer
    for (const v of versions.slice(0, 3)) expect(left.has(bytesToB64(v))).toBe(false);
    for (const v of versions.slice(3)) expect(left.has(bytesToB64(v))).toBe(true);
    // Varje kvarvarande säkerhetskopia går att återställa med rätt fil
    for (const b of autos) {
      const data = await backup.readICloudBackup(b.name);
      expect(data.songs[0].attachment!.dataUrl).toMatch(/^data:application\/pdf;base64,/);
    }
  });

  it('listar bara säkerhetskopior, inte mappen Filer', async () => {
    await backup.createICloudBackup();
    const list = await backup.listICloudBackups();
    expect(list.map((b) => b.name).every((n) => n.endsWith('.json'))).toBe(true);
  });
});

describe('mappen Låtar i iCloud', () => {
  it('sparar ChordPro som text och originalfiler byte för byte', async () => {
    await mirrorSongsToICloud();
    const names = filesIn('Låtar').map((p) => p.slice('Låtar/'.length)).sort();
    expect(names).toEqual(['Bild.jpeg', 'Noter A.pdf', 'Noter B.pdf', 'Text.cho']);
    expect(bytesToB64(fs.get('Låtar/Noter A.pdf')!.bytes)).toBe(bytesToB64(PDF1));
    expect(bytesToB64(fs.get('Låtar/Bild.jpeg')!.bytes)).toBe(bytesToB64(JPG));
    expect(new TextDecoder().decode(fs.get('Låtar/Text.cho')!.bytes)).toBe('{title: Text}\n[G]Hej [C]hå\n');
  });

  it('skriver bara om ändrade låtar och tar bort raderade', async () => {
    await mirrorSongsToICloud();
    native.writes = [];
    advance(60_000);
    await mirrorSongsToICloud();
    expect(native.writes.filter((p) => !p.endsWith('.songlist.json'))).toHaveLength(0);

    advance(60_000);
    const songs = useStore.getState().songs;
    useStore.setState({
      songs: {
        ...songs,
        d: { ...songs.d, content: '{title: Text}\n[D]Ny', updatedAt: Date.now() },
        b: { ...songs.b, deletedAt: Date.now(), updatedAt: Date.now() },
      },
    });
    fs.set('Låtar/Egen anteckning.txt', { bytes: new TextEncoder().encode('min fil'), modifiedAt: 0 });
    await mirrorSongsToICloud();
    expect(native.writes.filter((p) => !p.endsWith('.songlist.json'))).toEqual(['Låtar/Text.cho']);
    expect(fs.has('Låtar/Noter B.pdf')).toBe(false);
    expect(fs.has('Låtar/Egen anteckning.txt')).toBe(true); // filer appen inte skapat lämnas
  });

  it('skriver om en fil som nu hör till en annan låt med samma namn', async () => {
    setLibrary([
      { ...song('a', 'Visa'), content: '{title: Visa}\nFörsta', createdAt: 1 },
      { ...song('b', 'Visa'), content: '{title: Visa}\nAndra', createdAt: 2 },
    ]);
    await mirrorSongsToICloud();
    expect(new TextDecoder().decode(fs.get('Låtar/Visa (2).cho')!.bytes)).toContain('Andra');
    advance(60_000);
    // Den första raderas: den andra tar över namnet Visa.cho
    const songs = useStore.getState().songs;
    useStore.setState({ songs: { ...songs, a: { ...songs.a, deletedAt: Date.now(), updatedAt: Date.now() } } });
    await mirrorSongsToICloud();
    expect(new TextDecoder().decode(fs.get('Låtar/Visa.cho')!.bytes)).toContain('Andra');
    expect(fs.has('Låtar/Visa (2).cho')).toBe(false);
  });

  it('skriver ändringar som kommit via synk, även med äldre tidsstämpel', async () => {
    await mirrorSongsToICloud();
    advance(60_000);
    const songs = useStore.getState().songs;
    // Ändrad på en annan enhet innan den här speglade, men tagen emot först nu
    useStore.setState({ songs: { ...songs, d: { ...songs.d, content: '{title: Text}\n[Am]Från iPad', updatedAt: songs.d.updatedAt - 30_000 } } });
    await mirrorSongsToICloud();
    expect(new TextDecoder().decode(fs.get('Låtar/Text.cho')!.bytes)).toContain('Från iPad');
  });

  it('sparas vid varje säkerhetskopiering', async () => {
    await backup.createICloudBackup();
    expect(filesIn('Låtar')).toHaveLength(4);
  });
});

describe('återställning av ovanliga filer', () => {
  it('tar inte tillbaka raderade låtar från en synkfil, och tömmer raderade låtar vid "ersätt"', async () => {
    const file: BackupFile = {
      ...backup.buildBackup(),
      format: 'songlist-sync',
      songs: [
        { ...song('a', 'Kvar'), annotations: undefined },
        { ...song('gone', 'Raderad'), content: '', deletedAt: 5, updatedAt: 5 },
      ],
    };
    setLibrary([song('x', 'Lokal', { b: PDF1, name: 'x.pdf', mime: 'application/pdf' })]);
    await backup.restoreBackup(backup.parseBackup(JSON.stringify(file)), 'replace');
    const songs = useStore.getState().songs;
    expect(songs.gone).toBeUndefined();
    expect(songs.a.deletedAt).toBeUndefined();
    expect(songs.x.deletedAt).toBeDefined();
    expect(songs.x.attachment).toBeUndefined();
  });

  it('klarar poster som saknar fält', async () => {
    const broken = JSON.stringify({
      format: 'songlist-backup',
      version: 1,
      createdAt: 1,
      deviceId: 'd',
      songs: [{ id: 'trasig', updatedAt: 10 }, { title: 'utan id' }],
      setlists: [{ id: 'sl', updatedAt: 10, name: 'Lista' }],
      categories: [],
    });
    setLibrary([]);
    const n = await backup.restoreBackup(backup.parseBackup(broken), 'merge');
    expect(n).toBe(1);
    const s = useStore.getState().songs.trasig;
    expect(s.tags).toEqual([]);
    expect(s.content).toBe('');
    expect(useStore.getState().setlists.sl.items).toEqual([]);
  });
});
