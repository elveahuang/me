/**
 * 公开系统设置探针（只读，无副作用）。
 *
 * 供前端读取站点标题、默认语言、默认主题。值来自 public runtimeConfig，
 * 由启动插件载入并在管理端 PATCH 时刷新，不回源数据库、不含任何密钥。
 */
export default defineEventHandler(() => {
    return useRuntimeConfig().public.siteSettings;
});
