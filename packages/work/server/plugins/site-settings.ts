import { getCurrentSystemSettings, readSystemSettings, setCurrentSystemSettings } from '../utils/system-settings';

/**
 * 启动时把系统基础设置载入进程内状态，供 SSR 首屏渲染站点标题、
 * 默认语言与默认主题。数据库不可用（构建、迁移前）时保留静态默认值。
 *
 * Nitro 会对共享 runtimeConfig 深冻结（dev 与生产一致），不能在其上
 * Object.assign；SSR 与客户端 payload 消费的是 useRuntimeConfig(event)
 * 返回的每请求配置克隆，因此用 request 钩子把当前值注入该克隆。
 */
export default defineNitroPlugin(async (nitroApp) => {
    try {
        setCurrentSystemSettings(await readSystemSettings());
    } catch (error) {
        console.warn('[site-settings] 启动载入系统设置失败，回退静态默认值', error);
    }

    nitroApp.hooks.hook('request', (event) => {
        Object.assign(useRuntimeConfig(event).public.siteSettings, getCurrentSystemSettings());
    });
});
