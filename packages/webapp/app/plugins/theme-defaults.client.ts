/**
 * 用系统基础设置的默认显示模式为新访客播种 color-mode 偏好。
 *
 * 仅当用户从未自行选择过显示模式（localStorage 无 nuxt-color-mode）时才写入，
 * 已登录/已选过偏好的用户保持原样。color-mode 的免闪烁脚本在此之前已按系统偏好渲染，
 * 因此管理员把默认设为 light/dark 时，全新访客首屏可能有一次极短切换——为可接受的首访代价。
 */
const COLOR_MODE_KEY = 'nuxt-color-mode';

export default defineNuxtPlugin(() => {
    const configured = useRuntimeConfig().public.siteSettings.themeMode;
    if (configured !== 'light' && configured !== 'dark' && configured !== 'system') return;

    const colorMode = useColorMode();
    // 隐私模式/禁用存储时 localStorage 访问会抛异常，播种失败只影响下次访问的默认值，不该打断应用启动
    try {
        if (localStorage.getItem(COLOR_MODE_KEY) === null) {
            colorMode.preference = configured;
        }
    } catch {
        // ignore
    }
});
