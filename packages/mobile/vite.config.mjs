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
        // pnpm 工作区中 vue-router 存在多份 peer 变体（@ionic/vue 与应用代码各解析到一份），
        // 多实例会让注入键（Symbol(router) / Symbol(route location)）不一致，
        // 导致页面组件内 useRouter() / useRoute() 取到 undefined。强制去重为同一份。
        dedupe: ['vue-router'],
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
