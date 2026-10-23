// Synk mellan enheter via iCloud.
//
// Varje enhet skriver en egen fil (Data/Sync/<enhets-id>.json) med hela sitt bibliotek,
// inklusive raderade poster. Vid synk läses de andra enheternas filer och slås ihop post
// för post – den senast ändrade versionen vinner. Eftersom varje enhet bara skriver sin
// egen fil uppstår inga skrivkonflikter i iCloud.

import { App } from '@capacitor/app';
import { mergeLibrary } from '../lib/merge';
import { isBackupFile, type BackupFile } from '../lib/model';
import { hasNativePlugin, SongListNative } from '../native/songlistNative';
import { useStore } from '../store/useStore';
import { autoBackupIfDue } from './backup';

const SYNC_DIR = 'Sync';

export interface SyncResult {
  received: number;
  devices: number;
}

let running: Promise<SyncResult> | null = null;
/** En synk begärdes medan en annan pågick, t.ex. efter en ändring: kör en gång till efteråt */
let again = false;

export async function iCloudAvailable(): Promise<boolean> {
  if (!hasNativePlugin()) return false;
  try {
    return (await SongListNative.iCloudStatus()).available;
  } catch {
    return false;
  }
}

export function syncNow(): Promise<SyncResult> {
  if (running) {
    // Ändringar som gjorts efter att den pågående synken tog sin ögonblicksbild kommer annars
    // inte med förrän nästa ändring
    again = true;
    return running;
  }
  running = (async () => {
    let result: SyncResult;
    do {
      again = false;
      result = await doSync();
    } while (again);
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}

async function doSync(): Promise<SyncResult> {
  if (!hasNativePlugin()) throw new Error('Synk via iCloud finns bara i iOS-appen.');
  const { deviceId } = useStore.getState();
  const { files } = await SongListNative.listFiles({ scope: 'data', path: SYNC_DIR });
  let received = 0;
  let devices = 0;
  for (const f of files) {
    if (!f.name.endsWith('.json') || f.name === `${deviceId}.json`) continue;
    try {
      const { data } = await SongListNative.readFile({ scope: 'data', path: `${SYNC_DIR}/${f.name}` });
      const remote: unknown = JSON.parse(data);
      if (!isBackupFile(remote)) continue;
      devices++;
      const incoming = mergeLibrary(useStore.getState().exportLibrary(true), remote);
      received +=
        incoming.songs.length + incoming.setlists.length + incoming.categories.length + incoming.folders.length;
      await useStore.getState().applyIncoming(incoming);
    } catch (e) {
      console.warn('Kunde inte läsa synkfil', f.name, e);
    }
  }
  const snapshot: BackupFile = {
    format: 'songlist-sync',
    version: 1,
    createdAt: Date.now(),
    deviceId,
    ...useStore.getState().exportLibrary(true),
  };
  await SongListNative.writeFile({
    scope: 'data',
    path: `${SYNC_DIR}/${deviceId}.json`,
    data: JSON.stringify(snapshot),
  });
  await useStore.getState().updateSettings({ lastSyncAt: Date.now() });
  return { received, devices };
}

let started = false;

/** Startar automatisk synk: vid start, när appen återupptas och strax efter lokala ändringar. */
export async function startAutoSync(): Promise<void> {
  if (started || !hasNativePlugin()) return;
  started = true;

  const trySync = async () => {
    if (!useStore.getState().settings.autoSync) return;
    if (!(await iCloudAvailable())) return;
    try {
      await syncNow();
    } catch (e) {
      console.warn('Synk misslyckades', e);
    }
  };

  await trySync();
  void autoBackupIfDue();

  void App.addListener('resume', () => {
    void trySync();
    void autoBackupIfDue();
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastRevision = useStore.getState().revision;
  useStore.subscribe((s) => {
    if (s.revision === lastRevision) return;
    lastRevision = s.revision;
    clearTimeout(timer);
    timer = setTimeout(() => void trySync(), 4000);
  });
}
