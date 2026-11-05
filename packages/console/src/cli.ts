#!/usr/bin/env node
import { createTranslator, isLocale, LOCALES, type Locale } from './i18n.js';

interface ParsedArgs {
    locale: Locale;
    command: string | undefined;
    /** 传了 `--locale` 但不是受支持的值：要提示，而不是静默回落。 */
    invalidLocale?: string;
}

/**
 * 先摘选项、再取位置参数。
 *
 * 之前直接读 `process.argv[2]` 当命令，`console --locale=zh-CN status` 里的
 * `--locale=zh-CN` 会被当成命令名，真正的 `status` 静默丢弃——AGENTS.md 宣传的
 * 正是这种写法，等于文档给了一个不工作的用法。
 */
function parseArgs(argv: string[]): ParsedArgs {
    let locale: Locale = 'en-US';
    let invalidLocale: string | undefined;
    const positional: string[] = [];

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i]!;
        let candidate: string | undefined;
        if (arg.startsWith('--locale=')) {
            candidate = arg.slice('--locale='.length);
        } else if (arg === '--locale') {
            candidate = argv[i + 1];
            i += 1;
        } else if (!arg.startsWith('-')) {
            positional.push(arg);
            continue;
        } else {
            continue;
        }

        if (candidate && isLocale(candidate)) locale = candidate;
        else invalidLocale = candidate ?? '';
    }

    const fromEnv = process.env.CONSOLE_LOCALE;
    if (!invalidLocale && !argv.some((a) => a.startsWith('--locale')) && fromEnv) {
        if (isLocale(fromEnv)) locale = fromEnv;
        else invalidLocale = fromEnv;
    }

    return { locale, command: positional[0], invalidLocale };
}

const { locale, command, invalidLocale } = parseArgs(process.argv.slice(2));
const t = createTranslator(locale);

if (invalidLocale !== undefined) {
    console.error(`console: 未知语言 "${invalidLocale}"，支持：${LOCALES.join(', ')}；已回落 ${locale}`);
    process.exitCode = 2;
}

if (command === 'status') {
    console.log(t('commands.status'));
} else if (command === undefined) {
    console.log(t('greeting'));
    console.log(t('usage'));
} else {
    console.error(`${t('unknown')}: ${command}`);
    console.error(t('usage'));
    process.exitCode = 2;
}
