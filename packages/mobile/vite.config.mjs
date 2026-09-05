import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** @type {import('vite').UserConfig} */
export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        port: 8100,
    },
    resolve: {
        tsconfigPaths: true,
    },
});
