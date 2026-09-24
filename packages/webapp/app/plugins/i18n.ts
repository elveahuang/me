import { createI18n } from 'vue-i18n';
import enUS from '../locales/en-US';
import zhCN from '../locales/zh-CN';

type AppLocale = 'zh-CN' | 'en-US';

function isAppLocale(value: unknown): value is AppLocale {
    return value === 'zh-CN' || value === 'en-US';
}

// 隐私模式/禁用存储的浏览器里 localStorage 访问会直接抛异常，
// 插件初始化路径上裸读写会让整个应用挂掉；cookie 才是权威通道，读写失败静默降级即可。
function readStoredLocale(): string | null {
    try {
        return localStorage.getItem('app_locale');
    } catch {
        return null;
    }
}

function writeStoredLocale(value: AppLocale) {
    try {
        localStorage.setItem('app_locale', value);
    } catch {
        // 写不进去不影响本会话，cookie 已同步
    }
}

export default defineNuxtPlugin((nuxtApp) => {
    // 新访客默认语言来自系统基础设置（SSR/客户端一致）；用户偏好存 cookie，SSR 阶段即可
    // 用正确语言渲染 HTML，刷新不闪语言。localStorage 保留双写，兼容 cookie 尚未同步的旧偏好。
    const serverDefault = useRuntimeConfig().public.siteSettings.defaultLocale;
    const localeCookie = useCookie<AppLocale>('app_locale', {
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
        path: '/',
    });

    // SSR 只能看 cookie；客户端可能还有未同步进 cookie 的 localStorage 旧偏好。
    let initialLocale: AppLocale = isAppLocale(localeCookie.value) ? localeCookie.value : serverDefault === 'en-US' ? 'en-US' : 'zh-CN';

    if (import.meta.client) {
        const stored = readStoredLocale();
        if (isAppLocale(stored)) {
            if (localeCookie.value !== stored) {
                localeCookie.value = stored;
            }
            initialLocale = stored;
        } else if (isAppLocale(localeCookie.value)) {
            initialLocale = localeCookie.value;
            writeStoredLocale(localeCookie.value);
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
    const setLocale = (newLocale: AppLocale) => {
        i18n.global.locale.value = newLocale;
        if (import.meta.client) {
            localeCookie.value = newLocale;
            writeStoredLocale(newLocale);
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
