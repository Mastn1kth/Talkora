import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.talkora.learn',
  appName: 'Talkora',
  webDir: 'dist',
  backgroundColor: '#f8faf7',
  server: {
    androidScheme: 'https',
  },
};

export default config;
