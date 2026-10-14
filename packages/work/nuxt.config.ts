import { fileURLToPath } from 'node:url';
import { defineNuxtConfig } from 'nuxt/config';
import { resolve } from 'path';

export default defineNuxtConfig({
    compatibilityDate: '2026-06-30',
    modules: ['@nuxt/icon', '@nuxt/ui', '@comark/nuxt'],
    devtools: { enabled: false },
    css: [resolve(__dirname, 'app/assets/css/main.css')],
    /**
     * work 没有鉴权层，数据全部是单主的私人内容，因此只监听回环地址。
     * 生产同理必须 `node .output/server/index.mjs --host 127.0.0.1`，不要暴露端口。
     */
    devServer: {
        host: '127.0.0.1',
        port: 3001,
    },
    app: {
        head: {
            viewport: 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content',
        },
    },
    alias: {
        '@commons': fileURLToPath(new URL('../commons/src', import.meta.url)),
    },
    runtimeConfig: {
        deepseekApiKey: '',
        public: {
            siteSettings: {
                siteTitle: 'WORK',
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
