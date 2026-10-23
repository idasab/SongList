import { describe, expect, it, vi } from 'vitest';

const writes: string[] = [];
let release: (() => void) | null = null;

vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: async () => undefined }) } }));
vi.mock('../native/songlistNative', () => ({
  hasNativePlugin: () => true,
  SongListNative: {
    iCloudStatus: async () => ({ available: true, signedIn: true }),
    listFiles: async () => ({ files: [] }),
    readFile: async () => ({ data: '{}' }),
    deleteFile: async () => undefined,
    writeFile: async ({ data }: { data: string }) => {
      writes.push(data);
      // Den första skrivningen hålls kvar, som en långsam synk
      if (writes.length === 1) await new Promise<void>((r) => (release = r));
    },
  },
}));
vi.mock('../store/db', () => {
  const noop = async () => undefined;
  const table = { all: async () => [], put: noop, putMany: noop, clear: noop };
  return {
    requestPersistentStorage: noop,
    db: { songs: table, setlists: table, categories: table, folders: table, saveSettings: noop, getSettings: noop, getDeviceId: async () => 't', isFirstRun: async () => false },
  };
});

const { useStore } = await import('../store/useStore');
const { syncNow } = await import('./sync');

describe('synk', () => {
  it('kör en gång till om en synk begärs medan en annan pågår', async () => {
    useStore.setState({ deviceId: 't', songs: {}, setlists: {}, categories: {}, folders: {} });
    const first = syncNow();
    await vi.waitFor(() => expect(release).not.toBeNull());
    // En ändring medan den första synken skriver
    await useStore.getState().saveSong({ content: '{title: Ny under synken}' });
    const second = syncNow();
    release!();
    await Promise.all([first, second]);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toContain('Ny under synken');
    expect(writes[0]).not.toContain('Ny under synken');
  });
});

describe('exempellåten', () => {
  it('tas bort efter synk om det redan finns en orörd kopia från en annan enhet', async () => {
    const { SAMPLE_SONG } = await import('../store/sample');
    const base = { artist: '', tags: ['exempel'], transpose: 0, createdAt: 1 };
    useStore.setState({
      songs: {
        'songlist-exempel': { ...base, id: 'songlist-exempel', title: 'Välkommen', content: SAMPLE_SONG, updatedAt: 1 },
        gammal: { ...base, id: 'gammal', title: 'Välkommen', content: SAMPLE_SONG, updatedAt: 500 },
      },
    });
    writes.push('tidigare'); // den låtsade iCloud håller bara kvar allra första skrivningen
    await syncNow();
    expect(useStore.getState().songs['songlist-exempel'].deletedAt).toBeDefined();
    expect(useStore.getState().songs.gammal.deletedAt).toBeUndefined();
  });
});
