import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { isEmpty, isEqual } from 'radash';
import rollupCopy from 'rollup-plugin-copy';
import AutoImport from 'unplugin-auto-import/vite';
import IconsResolver from 'unplugin-icons/resolver';
import Icons from 'unplugin-icons/vite';
import { defineConfig, loadEnv } from 'vite';
import { viteVConsole } from 'vite-plugin-vconsole';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig(async ({ command, mode }) => {
    const env = loadEnv(mode, process.cwd());

    console.log(`Vite for admin. command - ${command}. mode - ${mode}.`);
    console.log(`command - ${command}. mode - ${mode}.`);
    console.log(env);

    return {
        base: env.VITE_APP_BASE ?? '/',
        resolve: {
            alias: {
                '~antd': 'antd',
                '~antd-mobile': 'antd-mobile',
                '~video.js': 'video.js',
            },
        },
        plugins: [
            react(),
            tsconfigPaths(),
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
            viteVConsole({
                entry: [resolve(__dirname, 'src/main.ts')],
                localEnabled: false,
                enabled: isEqual(env.VITE_APP_CONSOLE_ENABLED, 'true'),
            }),
            rollupCopy({
                targets: [
                    {
                        src: resolve(__dirname, '../../node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm'),
                        dest: process.env.NODE_ENV === 'production' ? 'dist/wasm' : 'public/wasm',
                    },
                ],
                hook: process.env.NODE_ENV === 'production' ? 'writeBundle' : 'buildStart',
            }),
        ],
        server: {
            host: !isEmpty(env.VITE_HOST) ? env.VITE_HOST : '0.0.0.0',
            port: !isEmpty(env.VITE_PORT) ? Number.parseInt(env.VITE_PORT) : 8083,
        },
        build: {
            modulePreload: false,
            target: 'ES2015',
        },
        optimizeDeps: {
            esbuildOptions: {
                define: {
                    global: 'globalThis',
                },
            },
        },
    };
});
