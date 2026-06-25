import tailwindcss from '@tailwindcss/vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig, loadEnv } from 'vite';

/** @type {import('vite').UserConfig} */
export default defineConfig(async ({ command, mode }) => {
    const env = loadEnv(mode, process.cwd());

    console.log(`Vite for webapp. command - ${command}. mode - ${mode}.`);
    console.log(`command - ${command}. mode - ${mode}.`);
    console.log(env);

    return defineConfig({
        resolve: { tsconfigPaths: true },
        plugins: [
            devtools(),
            tailwindcss(),
            tanstackStart({
                srcDirectory: 'src',
            }),
            tanstackRouter({
                srcDirectory: 'src',
                routerDirectory: 'src/router',
                generatedRouteTree: 'src/route.tree.ts',
            }),
            viteReact(),
            nitro(),
        ],
    });
});
