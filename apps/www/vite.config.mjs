import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { isEmpty } from 'es-toolkit/compat';
import { resolve } from 'path';
import AutoImport from 'unplugin-auto-import/vite';
import IconsResolver from 'unplugin-icons/resolver';
import Icons from 'unplugin-icons/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(async ({ command, mode }) => {
    const env = loadEnv(mode, process.cwd());

    console.log(`Vite for webapp. command - ${command}. mode - ${mode}.`);
    console.log(`command - ${command}. mode - ${mode}.`);
    console.log(env);

    return {
        base: env.VITE_APP_BASE ?? '/',
        plugins: [
            react(),
            tailwindcss(),
            AutoImport({
                resolvers: [
                    IconsResolver({
                        prefix: 'Icon',
                        extension: 'jsx',
                        enabledCollections: ['mdi'],
                    }),
                ],
                dts: resolve(__dirname, 'src/types/auto-imports.d.ts'),
            }),
            Icons({
                autoInstall: true,
                compiler: 'jsx',
            }),
        ],
        resolve: {
            tsconfigPaths: true,
        },
        server: {
            host: !isEmpty(env.VITE_HOST) ? env.VITE_HOST : '0.0.0.0',
            port: !isEmpty(env.VITE_PORT) ? Number.parseInt(env.VITE_PORT) : 8082,
        },
    };
});
