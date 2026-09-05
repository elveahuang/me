import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'me.mobile.app',
    appName: 'ME Mobile',
    webDir: 'dist',
    server: {
        // 本地开发时指向 webapp API（ Ionic dev server 默认 http://localhost:8100 ）
        androidScheme: 'https',
    },
};

export default config;
