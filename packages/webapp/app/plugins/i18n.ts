import { createI18n } from 'vue-i18n';
import enUS from '../locales/en-US';
import zhCN from '../locales/zh-CN';

export default defineNuxtPlugin((nuxtApp) => {
    // 获取初始语言设置（支持客户端从 localStorage / cookie 获取）
    let initialLocale = 'zh-CN';
    if (import.meta.client) {
        const stored = localStorage.getItem('app_locale');
        if (stored === 'en-US' || stored === 'zh-CN') {
            initialLocale = stored;
        } else if (navigator.language.startsWith('en')) {
            initialLocale = 'en-US';
        }
    }

    const i18n = createI18n({
        legacy: false,
        globalInjection: true,
        locale: initialLocale,
        fallbackLocale: 'zh-CN',
        messages: {
            'zh-CN': zhCN,
            'en-US': enUS,
        },
    });

    nuxtApp.vueApp.use(i18n);

    // 辅助切换语言并同步存储
    const setLocale = (newLocale: 'zh-CN' | 'en-US') => {
        i18n.global.locale.value = newLocale;
        if (import.meta.client) {
            localStorage.setItem('app_locale', newLocale);
            document.cookie = `app_locale=${newLocale}; path=/; max-age=31536000`;
            document.documentElement.lang = newLocale;
        }
    };

    return {
        provide: {
            t: i18n.global.t,
            i18n,
            setLocale,
            currentLocale: computed(() => i18n.global.locale.value),
        },
    };
});
