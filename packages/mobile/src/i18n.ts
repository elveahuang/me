import { createI18n } from 'vue-i18n';
import enUS from './locales/en-US';
import zhCN from './locales/zh-CN';

/** 受限 WebView（隐私模式/禁用存储）下 localStorage 与 navigator 都可能抛错：这是模块顶层代码，抛错即白屏 */
function detectLocale(): 'zh-CN' | 'en-US' {
    try {
        const saved = localStorage.getItem('mobile_locale');
        if (saved === 'zh-CN' || saved === 'en-US') return saved;
    } catch {
        // 读不到就继续走语言检测
    }
    return (navigator.language ?? 'zh').startsWith('en') ? 'en-US' : 'zh-CN';
}

const savedLocale = detectLocale();

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

/**
 * 把语言写进 `<html lang>`：读屏的发音、断词与浏览器的翻译提示都按它走。
 * index.html 里写死的是 zh-CN，只在用户手动切换时才更新会让「持久化偏好为英文」的设备
 * 在整个首屏阶段挂错语言，直到打开过一次语言选择为止。
 */
function applyDocumentLang(locale: 'zh-CN' | 'en-US') {
    document.documentElement.lang = locale;
}

/** 启动时同步一次，与 initTheme() 对称 */
export function initMobileLocale() {
    applyDocumentLang(savedLocale);
}

export function setMobileLocale(locale: 'zh-CN' | 'en-US') {
    i18n.global.locale.value = locale;
    try {
        localStorage.setItem('mobile_locale', locale);
    } catch {
        // 存储不可用时本次会话内仍生效，只是不持久化
    }
    applyDocumentLang(locale);
}
