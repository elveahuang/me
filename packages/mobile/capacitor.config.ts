import type { CapacitorConfig } from '@capacitor/cli';

/**
 * 原生壳配置：
 * - 默认加载本地打包产物（dist），API 通过 VITE_API_BASE 指向远端后端；
 * - 需要指向线上站点 / 真机联调时，设置 CAPACITOR_SERVER_URL（例如 https://app.example.com），
 *   此时 WebView 直接加载该地址，/api 与页面同源，无需再配 VITE_API_BASE。
 */
const remoteUrl = process.env.CAPACITOR_SERVER_URL;

const config: CapacitorConfig = {
    appId: 'com.ee.app', // 原生应用包标识：属于持久身份，改动会影响已安装应用的升级/关联，暂保留
    appName: 'ME',
    webDir: 'dist',
    server: {
        androidScheme: 'https',
        ...(remoteUrl ? { url: remoteUrl, cleartext: remoteUrl.startsWith('http://') } : {}),
    },
};

export default config;
