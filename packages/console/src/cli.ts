#!/usr/bin/env node
import { createTranslator, isLocale, type Locale } from './i18n.js';

function resolveLocale(): Locale {
    const fromArgv = process.argv.find((arg) => arg.startsWith('--locale='))?.split('=')[1];
    const fromEnv = process.env.CONSOLE_LOCALE;
    const candidate = fromArgv ?? fromEnv ?? 'en-US';
    return isLocale(candidate) ? candidate : 'en-US';
}

const locale = resolveLocale();
const t = createTranslator(locale);

const command = process.argv[2];

if (command === 'status') {
    console.log(t('commands.status'));
} else {
    console.log(t('greeting'));
    console.log(t('usage'));
}
