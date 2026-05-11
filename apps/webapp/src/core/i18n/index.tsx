import { log } from '@/core/utils';
import i18n from 'i18next';
import { JSX, PropsWithChildren } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

export async function loadCommonMessages(locale: string): Promise<any> {
    const messages: any = await import(`./locales/${locale.toLowerCase()}/label.json`);
    return messages.default ?? {};
}

export async function loadMessages(locale: string): Promise<any> {
    return {
        common: await loadCommonMessages(locale),
    };
}

export async function setupI18n(locale: string): Promise<void> {
    log(`I18N initialize.`);
    const messages: Record<string, any> = {
        ['zh']: await loadMessages('zh'),
        ['en']: await loadMessages('en'),
    };
    await i18n.use(initReactI18next).init({
        resources: messages,
        lng: locale,
        fallbackLng: 'zh',
        debug: false,
        interpolation: {
            escapeValue: false,
        },
    });
}

export function IntlProvider(props: PropsWithChildren): JSX.Element {
    return <I18nextProvider i18n={i18n}>{props.children}</I18nextProvider>;
}

export function useI18nExternal(): typeof i18n {
    return i18n;
}

export { i18n };
