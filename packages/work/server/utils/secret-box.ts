import { createError } from 'h3';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * 数据库内敏感字段的应用层加密（P4 部分）。
 *
 * - 主密钥来自 `WORK_SECRET_KEY`（64 位 hex 或 base64 的 32 字节）；未配置时保持明文，
 *   这样本地升级不会因为缺少环境变量而把所有供应商直接弄坏。
 * - 轮换期间可设 `WORK_SECRET_KEY_OLD`，解密先试当前密钥再试旧密钥；重新保存即完成换钥。
 * - 格式 `enc:v1:<iv>:<tag>:<ciphertext>`（base64url），AES-256-GCM，每次随机 12 字节 IV。
 */

const PREFIX = 'enc:v1:';
const MARKER = 'enc:v1:';

function parseKey(raw: string | undefined): Buffer | null {
    const value = (raw || '').trim();
    if (!value) return null;
    const hex = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : null;
    if (hex) return hex;
    try {
        const decoded = Buffer.from(value, 'base64');
        if (decoded.length === 32) return decoded;
    } catch {
        // 落到下面的统一错误
    }
    throw createError({ statusCode: 500, statusMessage: 'WORK_SECRET_KEY 必须是 64 位 hex 或 base64 的 32 字节' });
}

function currentKey(): Buffer | null {
    return parseKey(process.env.WORK_SECRET_KEY);
}

function oldKey(): Buffer | null {
    return parseKey(process.env.WORK_SECRET_KEY_OLD);
}

export function isSealed(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.startsWith(MARKER);
}

/** 加密明文；未配置主密钥或已是密文时原样返回。 */
export function sealSecret(value: string): string {
    if (!value || isSealed(value)) return value;
    const key = currentKey();
    if (!key) return value;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

/** 解密；明文/空串原样返回，密文但密钥缺失或校验失败时抛 500。 */
export function openSecret(value: string): string {
    if (!isSealed(value)) return value;
    const parts = value.slice(PREFIX.length).split(':');
    if (parts.length !== 3) {
        throw createError({ statusCode: 500, statusMessage: '密钥格式损坏，无法解密；请重新填写该密钥' });
    }
    const [ivRaw, tagRaw, dataRaw] = parts;
    const candidates = [currentKey(), oldKey()].filter((key): key is Buffer => Boolean(key));
    if (!candidates.length) {
        throw createError({ statusCode: 500, statusMessage: '该密钥已加密，请配置 WORK_SECRET_KEY 后再启动或重新填写' });
    }
    const iv = Buffer.from(ivRaw!, 'base64url');
    const tag = Buffer.from(tagRaw!, 'base64url');
    const data = Buffer.from(dataRaw!, 'base64url');
    for (const key of candidates) {
        try {
            const decipher = createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
        } catch {
            // 换钥期间当前密钥失败时继续试旧密钥
        }
    }
    throw createError({ statusCode: 500, statusMessage: '密钥解密失败（WORK_SECRET_KEY 不匹配），请重新填写该密钥' });
}
