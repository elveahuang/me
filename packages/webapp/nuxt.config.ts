import { fileURLToPath } from 'node:url';
import { defineNuxtConfig } from 'nuxt/config';
import { resolve } from 'path';

export default defineNuxtConfig({
    compatibilityDate: '2026-04-01',
    modules: ['@nuxt/content', '@nuxt/icon', '@nuxt/image', '@nuxt/ui', '@comark/nuxt'],
    devtools: { enabled: false },
    // 与 mobile 共用同一份接口契约 / 主题令牌（packages/contract）
    alias: {
        '@contract': fileURLToPath(new URL('../contract/src/index.ts', import.meta.url)),
    },
    css: [resolve(__dirname, 'app/assets/css/main.css')],
    content: {
        database: {
            type: 'postgresql',
            url: process.env.POSTGRES_URL as string,
        },
    },
    runtimeConfig: {
        deepseekApiKey: '',
    },
    // @nuxt/ui 默认会启用 @nuxt/fonts；其底层 unifont 需要拉取各字体源的元数据索引。
    // Google 字体元数据宿主 fonts.google.com 在当前网络下不可达，会触发
    // "Could not fetch from ... retries left" 的 WARN 并拖慢 dev 启动。
    // 项目未使用 Google 字体，禁用该 provider 即可（其他字体源仍可用）。
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
});
