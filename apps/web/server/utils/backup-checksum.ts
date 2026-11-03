import { createHash } from 'node:crypto';

/**
 * 备份内容校验和（P3-5 部分）。
 *
 * 顶层键按字典序拼接，避免 `Promise.all` 的完成顺序改变 `data` 的插入顺序后，
 * 同一批数据在不同进程里算出不同摘要。每张表内部保持导出时的行序。
 */
export function backupChecksum(data: Record<string, unknown>): string {
    const hash = createHash('sha256');
    for (const key of Object.keys(data).sort()) {
        hash.update(key);
        hash.update('\u0000');
        hash.update(JSON.stringify(data[key]) ?? 'null');
        hash.update('\n');
    }
    return hash.digest('hex');
}
