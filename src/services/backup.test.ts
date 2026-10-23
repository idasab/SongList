import { beforeEach, describe, expect, it, vi } from 'vitest';

// Låtsad iCloud Drive i minnet
const fs = new Map<string, string>();
vi.mock('../native/songlistNative', () => ({
  hasNativePlugin: () => true,
  SongListNative: {
    iCloudStatus: async () => ({ available: true, signedIn: true }),
    writeFile: async ({ path, data }: { path: string; data: string }) => void fs.set(path, data),
    readFile: async ({ path }: { path: string }) => {
      if (!fs.has(path)) throw new Error('NOT_FOUND');
      return { data: fs.get(path)! };
    },
    deleteFile: async ({ path }: { path: string }) => void fs.delete(path),
    listFiles: async ({ path }: { path: string }) => ({
      files: [...fs.keys()]
        .filter((p) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'))
        .map((p) => ({ name: p.slice(path.length + 1), modifiedAt: Date.now(), size: fs.get(p)!.length, downloaded: true })),
    }),
  },
}));

// Lokal lagring behövs inte i testet
vi.mock('../store/db', () => {
  const noop = async () => undefined;
  const table = { all: async () => [], put: noop, putMany: noop, clear: noop };
  return {
    requestPersistentStorage: noop,
    db: { songs: table, setlists: table, categories: table, folders: table, saveSettings: noop, getSettings: noop, getDeviceId: async () => 'test', isFirstRun: async () => false },
  };
});

const { useStore } = await import('../store/useStore');
const { createICloudBackup, deleteICloudBackup, listICloudBackups, readICloudBackup } = await import('./backup');

const PDF = 'data:application/pdf;base64,JVBERi0xLjQK';
const song = (id: string, title: string, dataUrl?: string) => ({
  id,
  title,
  artist: '',
  content: `{title: ${title}}`,
  tags: [],
  transpose: 0,
  createdAt: 1,
  updatedAt: 1,
  attachment: dataUrl ? { name: `${title}.pdf`, mime: 'application/pdf', dataUrl, kind: 'pdf' as const } : undefined,
});

describe('säkerhetskopior i iCloud med originalfiler', () => {
  beforeEach(() => {
    fs.clear();
    useStore.setState({ songs: { a: song('a', 'Noter A', PDF), b: song('b', 'Noter B', PDF), c: song('c', 'Text') } });
  });

  it('sparar varje fil en gång, pekar på den och hämtar den vid återställning', async () => {
    const name = await createICloudBackup();
    const stored = [...fs.keys()].filter((p) => p.startsWith('Säkerhetskopior/Filer/'));
    expect(stored).toHaveLength(1); // samma innehåll i två låtar
    const json = fs.get(`Säkerhetskopior/${name}`)!;
    expect(json).not.toContain('JVBERi0xLjQK');

    const restored = await readICloudBackup(name);
    expect(restored.songs.find((s) => s.id === 'a')!.attachment!.dataUrl).toBe(PDF);
    expect(restored.songs.find((s) => s.id === 'a')!.attachment!.file).toBeUndefined();
  });

  it('tar bort filer som ingen säkerhetskopia längre behöver', async () => {
    const name = await createICloudBackup();
    expect((await listICloudBackups()).length).toBe(1);
    await deleteICloudBackup(name);
    expect([...fs.keys()].filter((p) => p.startsWith('Säkerhetskopior/Filer/'))).toHaveLength(0);
  });
});
