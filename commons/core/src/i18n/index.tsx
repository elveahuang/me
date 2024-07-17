import { log } from '@commons/core/utils';
import { defaultLocale, Locale } from '@commons/core/utils/locale';
import i18n from 'i18next';
import { toLower } from 'lodash-es';
import React, { FC } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

export const loadCommonMessages = async (locale: string): Promise<any> => {
    const messages = await import(`./locales/${toLower(locale)}/common.json`);
    return messages.default ?? {};
};

export const loadExtraMessages = async (locale: string): Promise<any> => {
    const messages = await import(`./locales/${toLower(locale)}/extra.json`);
    return messages.default ?? {};
};

export const loadMessages = async (locale: string): Promise<any> => {
    return {
        common: await loadCommonMessages(locale),
        extra: await loadExtraMessages(locale),
    };
};

export const defaultNameSpace: string = 'common';

export const setI18nextLocale = async (locale: Locale): Promise<void> => {
    i18n.changeLanguage(locale).then();
};

export const setI18nextMessages = async (locale: Locale): Promise<void> => {
    log(locale);
};

export const setupI18n = async (locale: Locale = defaultLocale): Promise<void> => {
    log(`I18N initialize.`);
    const messages: Record<string, any> = {
        [Locale.ZH_CN]: await loadMessages(Locale.ZH_CN),
        [Locale.ZH_TW]: await loadMessages(Locale.ZH_TW),
        [Locale.EN_US]: await loadMessages(Locale.EN_US),
    };
    await i18n.use(initReactI18next).init({
        resources: messages,
        lng: locale,
        fallbackLng: defaultLocale,
        debug: false,
        interpolation: {
            escapeValue: false,
        },
    });
};

export type AppIntlProviderProps = React.PropsWithChildren<{}>;

export const AppIntlProvider: FC<AppIntlProviderProps> = (props: AppIntlProviderProps) => {
    log(`AppIntlProvider initialize.`);
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
