import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zh from './locales/zh.json';

// 服务端渲染安全：不在模块顶层直接访问 window/localStorage，
// 仅在浏览器环境读取用户上次选择的语言。
let lng = 'zh';
if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('app_lang');
    if (saved === 'en' || saved === 'zh') lng = saved;
}

void i18n.use(initReactI18next).init({
    resources: {
        zh: { translation: zh },
        en: { translation: en },
    },
    lng,
    fallbackLng: 'zh',
    // i18next 26：传入内联 resources 时 init 为同步执行，SSR 与水合阶段 t() 立即可用
    interpolation: {
        // React 已默认转义，关闭 i18next 的转义避免双重转义
        escapeValue: false,
    },
});

export default i18n;
