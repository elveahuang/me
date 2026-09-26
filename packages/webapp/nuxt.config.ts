import { fileURLToPath } from 'node:url';
import { defineNuxtConfig } from 'nuxt/config';
import { resolve } from 'path';

export default defineNuxtConfig({
    compatibilityDate: '2026-06-30',
    modules: ['@nuxt/content', '@nuxt/icon', '@nuxt/image', '@nuxt/ui', '@comark/nuxt'],
    devtools: { enabled: false },
    css: [resolve(__dirname, 'app/assets/css/main.css')],
    app: {
        head: {
            /**
             * viewport-fit=cover 让 theme.css 的 safe-top/safe-bottom（iOS 刘海/home indicator）真正生效；
             * interactive-widget=resizes-content 让 Android 键盘弹起时压缩视口而不是遮挡聊天输入栏
             * （iOS Safari 的 dvh 本身不含键盘，Chrome 108+ 需要这个开关）。
             */
            viewport: 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content',
        },
    },
    alias: {
        '@commons': fileURLToPath(new URL('../commons/src', import.meta.url)),
    },
    content: {
        database: {
            type: 'postgresql',
            url: process.env.POSTGRES_URL as string,
        },
    },
    runtimeConfig: {
        deepseekApiKey: '',
        public: {
            siteSettings: {
                siteTitle: 'ME',
                defaultLocale: 'zh-CN',
                themeMode: 'system',
                themeBrand: 'green',
            },
        },
    },
    nitro: {
        experimental: {
            tasks: true,
        },
        scheduledTasks: {
            '*/15 * * * *': ['orders:close-stale'],
        },
    },
    fonts: {
        providers: {
            google: false,
            googleicons: false,
        },
    },
    icon: {
        serverBundle: {
            collections: ['mdi'],
        },
    },
    vite: {
        optimizeDeps: {
            exclude: ['@nuxtjs/mdc'],
        },
    },
});
