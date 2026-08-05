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
    plugins: [devtools(), nitro({ rollupConfig: { external: [/^@sentry\//] } }), tailwindcss(), tanstackStart(), viteReact()],
});
