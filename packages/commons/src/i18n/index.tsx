import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import zh from './locales/zh.json';

export const setupI18n: () => Promise<void> = async (): Promise<void> => {
    const stored = localStorage.getItem('app_lang');
    const lng = stored === 'en' || stored === 'zh' ? stored : 'zh';

    void i18n.use(initReactI18next).init({
        resources: {
            en: { translation: en },
            zh: { translation: zh },
        },
        lng,
        fallbackLng: 'zh',
        interpolation: {
            escapeValue: false, // React 渲染已自带 XSS 转义
        },
    });
};

export default i18n;
