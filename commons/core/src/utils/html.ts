import { Locale } from '@commons/core/utils/locale';

export const setHtmlLang = async (locale: Locale | string): Promise<void> => {
    document.querySelector('html')?.setAttribute('lang', locale);
};

export const setHtmlTitle = async (title: string): Promise<void> => {
    document.title = title;
};
