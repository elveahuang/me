import { log } from '@/utils';
import i18n from 'i18next';
import React, { FC } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

export const loadCommonMessages = async (locale: string): Promise<any> => {
    const messages = await import(`./locales/${locale.toLowerCase()}/label.json`);
    return messages.default ?? {};
};

export const loadMessages = async (locale: string): Promise<any> => {
    return {
        common: await loadCommonMessages(locale),
    };
};

export const defaultNameSpace: string = 'common';

export const setI18nextLocale = async (locale: string): Promise<void> => {
    i18n.changeLanguage(locale).then();
};

export const setI18nextMessages = async (locale: string): Promise<void> => {
    log(locale);
};

export const setupI18n = async (locale: string): Promise<void> => {
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
};

export type AppIntlProviderProps = React.PropsWithChildren<{}>;

export const AppIntlProvider: FC<AppIntlProviderProps> = (props: AppIntlProviderProps) => {
    return (
        <I18nextProvider defaultNS={defaultNameSpace} i18n={i18n}>
            {props.children}
        </I18nextProvider>
    );
};

export const useI18nExternal = () => {
    return i18n;
};

export { i18n };
