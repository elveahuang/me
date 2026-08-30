import tailwindcss from '@tailwindcss/vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';

/** @type {import('vite').UserConfig} */
export default defineConfig({
    resolve: {
        tsconfigPaths: true,
    },
    plugins: [
        devtools(),
        nitro({
            // 规避 nitro beta + vite 8 (rolldown) 的跨 chunk 导出损坏问题：
            // 服务端产物输出为单一 chunk。
            rollupConfig: {
                external: [/^@sentry\//],
                output: {
                    inlineDynamicImports: true,
                },
            },
        }),
        tailwindcss(),
        tanstackStart(),
        viteReact(),
    ],
});
