import { DEFAULT_BRAND, THEME_BRANDS, isThemeBrand, type ThemeBrand } from '@commons/contract';

/**
 * 主题状态（Web 端）：
 * - 浅色 / 深色 / 跟随系统：交给 Nuxt UI 内置的 @nuxtjs/color-mode（自带免闪烁脚本与系统偏好监听）
 * - 蓝 / 绿 / 黄 三色（含红色共四色）：通过 <html data-brand> 驱动 packages/commons/src/styles/theme.css 里的令牌
 *
 * 品牌色写入 cookie，SSR 阶段即可输出正确的 data-brand，刷新不会闪色。
 */
const BRAND_COOKIE = 'ee_theme_brand';

export function useTheme() {
    const colorMode = useColorMode();
    const appConfig = useAppConfig();

    const brandCookie = useCookie<string>(BRAND_COOKIE, {
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
        path: '/',
    });

    // 新访客（无品牌 cookie）用系统基础设置的默认品牌色；SSR 即可输出正确 data-brand，不闪色。
    const configuredBrand = useRuntimeConfig().public.siteSettings.themeBrand;
    const fallbackBrand: ThemeBrand = isThemeBrand(configuredBrand) ? configuredBrand : DEFAULT_BRAND;
    const brand = computed<ThemeBrand>(() => (isThemeBrand(brandCookie.value) ? brandCookie.value : fallbackBrand));
    const mode = computed<'light' | 'dark' | 'system'>(() => {
        const preference = colorMode.preference;
        return preference === 'light' || preference === 'dark' ? preference : 'system';
    });
    const isDark = computed(() => colorMode.value === 'dark');

    // SSR + 客户端同步：<html data-brand="...">
    useHead({
        htmlAttrs: {
            'data-brand': brand,
        },
    });

    // Nuxt UI 组件（UApp / 表单等）使用 --ui-color-primary-*，跟随同一品牌色
    watchEffect(() => {
        appConfig.ui.colors.primary = brand.value;
    });

    function setBrand(next: ThemeBrand) {
        brandCookie.value = next;
    }

    function setMode(next: 'light' | 'dark' | 'system') {
        colorMode.preference = next;
    }

    function toggleMode() {
        setMode(colorMode.value === 'dark' ? 'light' : 'dark');
    }

    function cycleBrand() {
        const index = THEME_BRANDS.indexOf(brand.value);
        setBrand(THEME_BRANDS[(index + 1) % THEME_BRANDS.length]!);
    }

    return {
        brand,
        mode,
        isDark,
        brands: THEME_BRANDS,
        setBrand,
        setMode,
        toggleMode,
        cycleBrand,
    };
}
