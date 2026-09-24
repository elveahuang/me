import {
    applyThemeToElement,
    DEFAULT_BRAND,
    DEFAULT_MODE,
    parseTheme,
    resolveDarkClass,
    serializeTheme,
    THEME_STORAGE_KEY,
    type ThemeBrand,
    type ThemeMode,
} from '@commons/contract';
import { readonly, ref } from 'vue';

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
