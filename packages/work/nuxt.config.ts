import { fileURLToPath } from 'node:url';
import { defineNuxtConfig } from 'nuxt/config';

export default defineNuxtConfig({
    compatibilityDate: '2026-06-30',
    modules: ['@nuxt/icon', '@nuxt/ui', '@comark/nuxt'],
    devtools: { enabled: false },
    // 本包是 ESM（package.json 的 "type": "module"），配置里的 `__dirname` 不存在
    css: [fileURLToPath(new URL('app/assets/css/main.css', import.meta.url))],
    /**
     * work 没有鉴权层，数据全部是单主的私人内容，因此只监听回环地址。
     *
     * 生产不能用 `node .output/server/index.mjs --host 127.0.0.1`：nitro 的 node preset 只读
     * `NITRO_HOST`/`HOST` 环境变量，不解析命令行参数，带 `--host` 照样绑到 0.0.0.0（已实测）。
     * 正确写法是 `NITRO_HOST=127.0.0.1 node .output/server/index.mjs`；
     * `server/utils/env-guard.ts` 会在生产启动时把「没设回环绑定」当成拒绝启动的问题。
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
