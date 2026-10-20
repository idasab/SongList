import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'se.otimo.songlist',
  appName: 'SongList',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    // Låt webbinnehållet styra scroll/zoom själv.
    scrollEnabled: true,
  },
};

export default config;
