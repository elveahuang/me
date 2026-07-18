import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { reactCompilerPreset } from '@vitejs/plugin-react';
import { voidReact } from '@void/react/plugin';
import { defineConfig } from 'vite';
import { voidPlugin } from 'void';

/** @type {import('vite').UserConfig} */
export default defineConfig({
    plugins: [
        babel({
            presets: [reactCompilerPreset()],
        }),
        voidPlugin(),
        voidReact(),
        tailwindcss(),
    ],
});
