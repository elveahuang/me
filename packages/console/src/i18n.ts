import enUS from './locales/en-US.json' with { type: 'json' };
import zhCN from './locales/zh-CN.json' with { type: 'json' };

export const LOCALES = ['en-US', 'zh-CN'] as const;
export type Locale = (typeof LOCALES)[number];

const RESOURCES: Record<Locale, unknown> = {
    'en-US': enUS,
    'zh-CN': zhCN,
};

type Leaves = { [key: string]: string | Leaves };

function lookup(source: unknown, path: string[]): string | undefined {
    let node: unknown = source;
    for (const segment of path) {
        if (typeof node !== 'object' || node === null) return undefined;
        node = (node as Leaves)[segment];
    }
    return typeof node === 'string' ? node : undefined;
}

export function isLocale(value: string): value is Locale {
    return (LOCALES as readonly string[]).includes(value);
}

/**
 * 极简翻译函数：按 key 查当前语言的文案，缺失时回落源语言（en-US）。
 * x18n 通过 x18n.config.ts 的 usage.calls 中的 `t` 识别这里的使用点。
 */
export function createTranslator(locale: Locale) {
    return function t(key: string): string {
        const path = key.split('.');
        const value = lookup(RESOURCES[locale], path) ?? lookup(RESOURCES['en-US'], path);
        return value ?? key;
    };
}
