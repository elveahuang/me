import { defineConfig } from '@x18n/core';

export default defineConfig({
    sourceLocale: 'en-US',
    resources: [{ pattern: 'src/locales/{locale}.json' }],
    usage: {
        include: ['src/**/*'],
        calls: [{ callee: 't' }],
    },
});
