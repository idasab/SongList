import { Capacitor, registerPlugin } from '@capacitor/core';
import type { OcrPage } from '../lib/ocrLayout';

export type ICloudScope = 'documents' | 'data';

export interface ICloudFile {
  name: string;
  modifiedAt: number;
  size: number;
  downloaded: boolean;
}

/** Gränssnitt mot den inbyggda iOS-koden i native-plugin/. */
export interface SongListNativePlugin {
  iCloudStatus(): Promise<{ available: boolean; signedIn: boolean }>;
  writeFile(options: { scope: ICloudScope; path: string; data: string }): Promise<void>;
  readFile(options: { scope: ICloudScope; path: string }): Promise<{ data: string }>;
  listFiles(options: { scope: ICloudScope; path: string }): Promise<{ files: ICloudFile[] }>;
  deleteFile(options: { scope: ICloudScope; path: string }): Promise<void>;
  scanDocument(): Promise<{ pages: OcrPage[]; imageDataUrl?: string }>;
  recognizeImage(options: { image: string }): Promise<{ page: OcrPage }>;
}

export const SongListNative = registerPlugin<SongListNativePlugin>('SongListNative');

export const isNative = Capacitor.isNativePlatform();
export const isIOS = Capacitor.getPlatform() === 'ios';

/** Sant om den inbyggda pluginen finns (dvs. appen körs som iOS-app). */
export function hasNativePlugin(): boolean {
  return isIOS && Capacitor.isPluginAvailable('SongListNative');
}
