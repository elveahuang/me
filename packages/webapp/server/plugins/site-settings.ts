import { readSystemSettings } from '../utils/system-settings';

/**
 * 启动时把系统基础设置载入 public runtimeConfig，供 SSR 首屏渲染站点标题、
 * 默认语言与默认主题。数据库不可用（构建、迁移前）时保留 nuxt.config 的静态默认值。
 */
export default defineNitroPlugin(async () => {
    try {
        const settings = await readSystemSettings();
        Object.assign(useRuntimeConfig().public.siteSettings, settings);
    } catch (error) {
        console.warn('[site-settings] 启动载入系统设置失败，回退静态默认值', error);
    }
});
