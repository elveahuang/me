import { createError } from 'h3';
import { stripNull } from './pg-text';

/**
 * 存储配置的文本列归一（POST 与 PATCH 共用一份）。
 *
 * 两处原来都是 `stripNull(String(body[key]))`：对象与数组不会报错，而是被 stringify 成
 * `[object Object]` / `a,b` 直接落库。请求回 200、界面显示「已保存」，坏数据却要到很远的
 * 地方才现形——`publicBaseUrl` 变成 `[object Object]` 之后，全站附件的公共下载地址都拼成
 * 无效前缀；`accessKeyId`/`secretAccessKey` 变成这种值时，症状只是「这个桶连不上」，
 * 谁也不会想到是某次保存把对象塞进了字符串列。
 * 与 `normalizeAdminBoolean`、`normalizeProviderModels` 同一立场：形状错就 400，
 * 不要用 `String()` 把客户端的错误翻译成一条合法但无意义的值。
 *
 * `null` 仍然表示「清空这一列」（列都是 notNull default ''），`undefined` 由调用方挡在外面。
 */
const STORAGE_TEXT_LIMITS: Record<string, number> = {
    name: 100,
    provider: 32,
    region: 64,
    bucket: 255,
    accessKeyId: 256,
    secretAccessKey: 512,
    publicBaseUrl: 2000,
    prefix: 200,
};
const STORAGE_TEXT_DEFAULT_MAX = 1000;

/**
 * publicBaseUrl 会被原样拼成附件的展示/下载地址（storage.ts 的 buildPublicUrl）。
 * 存成相对路径或 `javascript:` 不会在保存时报错，只会在每次打开附件时悄悄失效——
 * 前端把它当 href/src 用的那一侧，`javascript:` 还会被执行。留空表示回退预签名，
 * 非空时必须是绝对 http/https 地址。
 */
function assertPublicBaseUrl(value: string): void {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw createError({ statusCode: 400, statusMessage: 'publicBaseUrl 不是合法 URL' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw createError({ statusCode: 400, statusMessage: 'publicBaseUrl 仅允许 http/https 协议' });
    }
}

export function normalizeStorageText(raw: unknown, label: string): string {
    if (raw === null) return '';
    if (typeof raw !== 'string') throw createError({ statusCode: 400, statusMessage: `${label} 必须为字符串` });
    const value = stripNull(raw);
    const max = STORAGE_TEXT_LIMITS[label] ?? STORAGE_TEXT_DEFAULT_MAX;
    if (value.length > max) throw createError({ statusCode: 400, statusMessage: `${label} 过长（最多 ${max} 字符）` });
    if (label === 'publicBaseUrl' && value) assertPublicBaseUrl(value);
    return value;
}
