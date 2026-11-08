import { apiUrl } from '../api/client';
import { isNativeShell } from '../composables/useUpload';

/**
 * 移动端媒体地址守卫（`<img>`/封面图渲染前的最后一道）。
 *
 * 原生壳里 `<img>` 带不上 Bearer，站内相对地址还会解析到 capacitor://localhost（404 裂图）。
 * 这里对 URL 做两段判定：
 * - 绝对 http(s)（含经 apiUrl 绝对化后的远端地址）→ 可渲染，原样返回；
 * - 相对地址 → 浏览器同源可渲染（cookie 自动携带），原生壳必坏 → 返回空串让模板的 v-if 整块隐藏。
 *
 * 服务端契约层面的正解是让 imageUrl/coverImage 一律回公网可读的绝对地址
 * （同附件列表已签发 `item.url` 的做法）；本守卫只是渲染侧的兜底，不替代契约。
 */
export function renderableMediaUrl(url: string): string {
    if (!url) return '';
    const absolute = apiUrl(url);
    if (/^https?:\/\//i.test(absolute)) return absolute;
    return isNativeShell() ? '' : absolute;
}
