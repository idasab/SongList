// Säkerhetskopiering: till iCloud Drive (iOS) eller som fil (alla plattformar).

import { restoreMerge } from '../lib/merge';
import { isBackupFile, type BackupFile, type SyncRecord } from '../lib/model';
import { hasNativePlugin, SongListNative } from '../native/songlistNative';
import { useStore } from '../store/useStore';
import { saveTextFile } from './files';

const BACKUP_DIR = 'Säkerhetskopior';
const AUTO_PREFIX = 'Auto ';
const MAX_AUTO_BACKUPS = 10;
const WEEK = 7 * 24 * 3600 * 1000;

export function buildBackup(): BackupFile {
  const s = useStore.getState();
  return {
    format: 'songlist-backup',
    version: 1,
    createdAt: Date.now(),
    deviceId: s.deviceId,
    ...s.exportLibrary(false),
  };
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Filen är inte en giltig säkerhetskopia (felaktig JSON).');
  }
  if (!isBackupFile(data)) throw new Error('Filen är inte en SongList-säkerhetskopia.');
  return data;
}

export type RestoreMode = 'merge' | 'replace';

/**
 * Återställer en säkerhetskopia.
 * - merge: lägger till låtar som saknas och återskapar raderade, behåller nyare lokala ändringar
 * - replace: biblioteket blir exakt som säkerhetskopian (övrigt raderas, även på synkade enheter)
 */
export async function restoreBackup(data: BackupFile, mode: RestoreMode): Promise<number> {
  const store = useStore.getState();
  const local = store.exportLibrary(true);
  const now = Date.now();

  const replaceList = <T extends SyncRecord>(localList: T[], backupList: T[], wipe: (t: T) => T): T[] => {
    const inBackup = new Set(backupList.map((b) => b.id));
    const tombs = localList
      .filter((l) => !l.deletedAt && !inBackup.has(l.id))
      .map((l) => ({ ...wipe(l), deletedAt: now, updatedAt: now }));
    const restored = backupList.map((b) => ({ ...b, deletedAt: undefined, updatedAt: now }));
    return [...tombs, ...restored];
  };

  const incoming =
    mode === 'merge'
      ? {
          songs: restoreMerge(local.songs, data.songs, now),
          setlists: restoreMerge(local.setlists, data.setlists, now),
          categories: restoreMerge(local.categories, data.categories, now),
        }
      : {
          songs: replaceList(local.songs, data.songs, (s) => ({ ...s, content: '', tags: [] })),
          setlists: replaceList(local.setlists, data.setlists, (s) => ({ ...s, items: [] })),
          categories: replaceList(local.categories, data.categories, (c) => c),
        };
  await store.applyIncoming(incoming, { local: true });
  return incoming.songs.filter((s) => !s.deletedAt).length;
}

export async function exportBackupFile(): Promise<void> {
  const data = buildBackup();
  await saveTextFile(`SongList ${stamp()}.json`, JSON.stringify(data, null, 1), 'application/json');
}

// --- iCloud ---

export interface ICloudBackup {
  name: string;
  modifiedAt: number;
  size: number;
}

export async function createICloudBackup(auto = false): Promise<string> {
  if (!hasNativePlugin()) throw new Error('iCloud är bara tillgängligt i iOS-appen.');
  const name = `${auto ? AUTO_PREFIX : ''}SongList ${stamp()}.json`;
  await SongListNative.writeFile({
    scope: 'documents',
    path: `${BACKUP_DIR}/${name}`,
    data: JSON.stringify(buildBackup()),
  });
  await useStore.getState().updateSettings({ lastBackupAt: Date.now() });
  if (auto) await pruneAutoBackups();
  return name;
}

export async function listICloudBackups(): Promise<ICloudBackup[]> {
  if (!hasNativePlugin()) return [];
  const { files } = await SongListNative.listFiles({ scope: 'documents', path: BACKUP_DIR });
  return files
    .filter((f) => f.name.endsWith('.json'))
    .sort((a, b) => b.name.replace(AUTO_PREFIX, '').localeCompare(a.name.replace(AUTO_PREFIX, '')));
}

export async function readICloudBackup(name: string): Promise<BackupFile> {
  const { data } = await SongListNative.readFile({ scope: 'documents', path: `${BACKUP_DIR}/${name}` });
  return parseBackup(data);
}

export async function deleteICloudBackup(name: string): Promise<void> {
  await SongListNative.deleteFile({ scope: 'documents', path: `${BACKUP_DIR}/${name}` });
}

async function pruneAutoBackups(): Promise<void> {
  const autos = (await listICloudBackups()).filter((b) => b.name.startsWith(AUTO_PREFIX));
  for (const old of autos.slice(MAX_AUTO_BACKUPS)) {
    try {
      await deleteICloudBackup(old.name);
    } catch {
      // Försök igen nästa gång
    }
  }
}

/** Gör en automatisk veckobackup till iCloud om det är dags. */
export async function autoBackupIfDue(): Promise<void> {
  const { settings } = useStore.getState();
  if (!settings.autoBackup || !hasNativePlugin()) return;
  if (settings.lastBackupAt && Date.now() - settings.lastBackupAt < WEEK) return;
  try {
    const status = await SongListNative.iCloudStatus();
    if (status.available) await createICloudBackup(true);
  } catch (e) {
    console.warn('Automatisk backup misslyckades', e);
  }
}
