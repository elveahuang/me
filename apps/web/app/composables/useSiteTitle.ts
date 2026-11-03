/**
 * 工作台名称的可写镜像。
 *
 * `useRuntimeConfig()` 的返回值不是响应式的：改名成功后侧栏品牌与浏览器标题原本要等下一次
 * SSR 才更新。这里用 `useState` 做一层共享状态，写入方（通用设置页）与读取方（app.vue、外壳侧栏）
 * 用同一个 key，改名当场生效；SSR 阶段工厂函数从 runtimeConfig 播种，首屏即为库里的值。
 */
export function useSiteTitle() {
    return useState<string>('site-title', () => useRuntimeConfig().public.siteSettings.siteTitle);
}
