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
export function normalizeStorageText(raw: unknown, label: string): string {
    if (raw === null) return '';
    if (typeof raw !== 'string') throw createError({ statusCode: 400, statusMessage: `${label} 必须为字符串` });
    return stripNull(raw);
}
