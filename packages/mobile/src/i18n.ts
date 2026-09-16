import { createI18n } from 'vue-i18n';
import enUS from './locales/en-US';
import zhCN from './locales/zh-CN';

const savedLocale = localStorage.getItem('mobile_locale') || (navigator.language.startsWith('en') ? 'en-US' : 'zh-CN');

export const i18n = createI18n({
    legacy: false,
    globalInjection: true,
    locale: savedLocale,
    fallbackLocale: 'zh-CN',
    messages: {
        'zh-CN': zhCN,
        'en-US': enUS,
    },
});

export function setMobileLocale(locale: 'zh-CN' | 'en-US') {
    i18n.global.locale.value = locale;
    localStorage.setItem('mobile_locale', locale);
    document.documentElement.lang = locale;
}
