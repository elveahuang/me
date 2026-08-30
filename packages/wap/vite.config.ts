import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 8100,
    },
    resolve: {
        alias: {
            '@': new URL('./src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
        },
    },
});
