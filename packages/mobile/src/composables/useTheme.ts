import {
    DEFAULT_BRAND,
    DEFAULT_MODE,
    parseTheme,
    resolveDarkClass,
    serializeTheme,
    THEME_STORAGE_KEY,
    type ThemeBrand,
    type ThemeMode,
    type ThemeState,
} from '@commons/contract';
import { readonly, ref } from 'vue';

/**
 * 把主题写到 <html> 上（从 contract 搬回唯一消费方）：
 * - `.dark` 类：Tailwind / Nuxt UI / Ionic 深色主题开关
 * - `ion-palette-dark`：Ionic 的深色调色板
 * - `data-brand`：四色主题令牌（theme.css 中的 --brand-*）
 * - `color-scheme`：让浏览器原生控件（滚动条、输入框）跟随
 *
 * contract 是服务端也会 import 的共享层，不能引用 DOM 类型（server tsconfig 无 DOM lib，
 * 此前这一函数让 webapp 服务端标注契约返回值时直接编译报错）。
 */
function applyThemeToElement(el: HTMLElement, state: ThemeState, prefersDark: boolean): void {
    const dark = resolveDarkClass(state.mode, prefersDark);
    el.classList.toggle('dark', dark);
    el.classList.toggle('ion-palette-dark', dark);
    el.dataset.brand = state.brand;
    el.style.colorScheme = dark ? 'dark' : 'light';
}

/**
 * 移动端主题：与 webapp 使用同一套契约（浅色/深色/跟随系统 + 蓝绿黄红四色），
 * 状态存 localStorage，通过 <html data-brand> 与 .dark / .ion-palette-dark 生效。
 */
const mode = ref<ThemeMode>(DEFAULT_MODE);
const brand = ref<ThemeBrand>(DEFAULT_BRAND);

function mediaQuery(): MediaQueryList | null {
    return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
}

function paint() {
    if (typeof document === 'undefined') return;
    const prefersDark = mediaQuery()?.matches ?? false;
    applyThemeToElement(document.documentElement, { mode: mode.value, brand: brand.value }, prefersDark);
}

function persist() {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, serializeTheme({ mode: mode.value, brand: brand.value }));
    } catch {
        // localStorage 不可用时忽略
    }
}

function readStored(): { mode: ThemeMode; brand: ThemeBrand } {
    try {
        return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
        return { mode: DEFAULT_MODE, brand: DEFAULT_BRAND };
    }
}

/** 在应用挂载前调用，读取本地设置并立即上色，避免首屏闪烁 */
export function initTheme() {
    const stored = readStored();
    mode.value = stored.mode;
    brand.value = stored.brand;
    paint();

    mediaQuery()?.addEventListener?.('change', () => {
        if (mode.value === 'system') paint();
    });
}

export function useTheme() {
    function setMode(next: ThemeMode) {
        mode.value = next;
        persist();
        paint();
    }

    function setBrand(next: ThemeBrand) {
        brand.value = next;
        persist();
        paint();
    }

    function toggleMode() {
        const isDark = resolveDarkClass(mode.value, mediaQuery()?.matches ?? false);
        setMode(isDark ? 'light' : 'dark');
    }

    return {
        mode: readonly(mode),
        brand: readonly(brand),
        setMode,
        setBrand,
        toggleMode,
    };
}
