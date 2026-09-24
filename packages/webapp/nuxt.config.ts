import { fileURLToPath } from 'node:url';
import { defineNuxtConfig } from 'nuxt/config';
import { resolve } from 'path';

export default defineNuxtConfig({
    compatibilityDate: '2026-06-30',
    modules: ['@nuxt/content', '@nuxt/icon', '@nuxt/image', '@nuxt/ui', '@comark/nuxt'],
    devtools: { enabled: false },
    css: [resolve(__dirname, 'app/assets/css/main.css')],
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
