import { createI18n } from 'vue-i18n';
import enUS from '../locales/en-US';
import zhCN from '../locales/zh-CN';

export default defineNuxtPlugin((nuxtApp) => {
    // 新访客默认语言来自系统基础设置（SSR/客户端一致）；用户已存储的偏好始终优先。
    const serverDefault = useRuntimeConfig().public.siteSettings.defaultLocale;
    let initialLocale = serverDefault === 'en-US' ? 'en-US' : 'zh-CN';
    if (import.meta.client) {
        const stored = localStorage.getItem('app_locale');
        if (stored === 'en-US' || stored === 'zh-CN') {
            initialLocale = stored;
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
