import { defineConfig } from 'oxfmt';

export default defineConfig({
    printWidth: 120,
    tabWidth: 4,
    endOfLine: 'lf',
    singleQuote: true,
    jsxSingleQuote: true,
    options: {
        typeAware: true,
    },
    ignorePatterns: ['dist/**', '*.min.js', 'auto-imports.d.ts'],
});
