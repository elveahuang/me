import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [vue(), tailwindcss()],
    resolve: {
        alias: {
            // 与 webapp 共用同一份接口契约 / 主题令牌
            '@contract': fileURLToPath(new URL('../contract/src/index.ts', import.meta.url)),
        },
        tsconfigPaths: true,
    },
    // 开发与预览都把 /api 代理到 webapp（生产由 VITE_API_BASE 指向远端后端）
    server: {
        proxy: {
            '/api': {
                target: process.env.API_PROXY_TARGET || 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
    preview: {
        proxy: {
            '/api': {
                target: process.env.API_PROXY_TARGET || 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
});
