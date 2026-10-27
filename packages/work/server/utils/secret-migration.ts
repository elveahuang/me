import { eq } from 'drizzle-orm';
import { mcpServers, providers, storageConfigs, tools } from '../db/schema';
import { db } from './db';
import { isSealed, openSecret, sealSecret } from './secret-box';

/**
 * 把历史明文密钥批量加密（P4）。
 *
 * 覆盖四处落库的凭据：`providers.api_key`、`storage_configs.secret_access_key`、
 * `mcp_servers.headers` 与 `tools.config.headers`（只动 headers，URL/参数等配置原样保留）。
 *
 * 三条边界：
 * - 只处理**明文**行；已经 `enc:v1:` 的值原样跳过，所以脚本可重复执行，也不会用当前钥
 *   把旧钥加密的数据再包一层（换钥仍需重新保存或专门的 rewrap）。
 * - 未配置 `WORK_SECRET_KEY` 时一个字节都不写；`sealSecret` 此时本来也会原样返回，
 *   但不能让调用方误以为「跑过了就是加密了」，结果里明确 `keyConfigured=false`。
 * - 写入前做一次 `openSecret(sealSecret(value)) === value` 的自校验；失败即中止，
 *   避免因为密钥解析问题把明文写成不可解密的密文。
 */

export interface SecretMigrationResult {
    keyConfigured: boolean;
    dryRun: boolean;
    providers: number;
    storageConfigs: number;
    mcpServers: number;
    tools: number;
    skippedSealed: number;
    total: number;
}

export async function encryptLegacySecrets(options: { dryRun?: boolean } = {}): Promise<SecretMigrationResult> {
    const dryRun = options.dryRun === true;
    const keyConfigured = Boolean(process.env.WORK_SECRET_KEY?.trim());
    const result: SecretMigrationResult = {
        keyConfigured,
        dryRun,
        providers: 0,
        storageConfigs: 0,
        mcpServers: 0,
        tools: 0,
        skippedSealed: 0,
        total: 0,
    };
    if (!keyConfigured) return result;

    const seal = (value: string): string => {
        const sealed = sealSecret(value);
        if (openSecret(sealed) !== value) throw new Error('密钥自校验失败：加密结果无法还原，已中止');
        return sealed;
    };

    for (const row of await db.select({ id: providers.id, apiKey: providers.apiKey }).from(providers)) {
        if (!row.apiKey) continue;
        if (isSealed(row.apiKey)) {
            result.skippedSealed += 1;
            continue;
        }
        if (!dryRun)
            await db
                .update(providers)
                .set({ apiKey: seal(row.apiKey) })
                .where(eq(providers.id, row.id));
        result.providers += 1;
    }

    for (const row of await db.select({ id: storageConfigs.id, secretAccessKey: storageConfigs.secretAccessKey }).from(storageConfigs)) {
        if (!row.secretAccessKey) continue;
        if (isSealed(row.secretAccessKey)) {
            result.skippedSealed += 1;
            continue;
        }
        if (!dryRun)
            await db
                .update(storageConfigs)
                .set({ secretAccessKey: seal(row.secretAccessKey) })
                .where(eq(storageConfigs.id, row.id));
        result.storageConfigs += 1;
    }

    for (const row of await db.select({ id: mcpServers.id, headers: mcpServers.headers }).from(mcpServers)) {
        const next: Record<string, string> = {};
        let changed = false;
        for (const [name, value] of Object.entries(row.headers ?? {})) {
            if (!value) {
                next[name] = value;
                continue;
            }
            if (isSealed(value)) {
                result.skippedSealed += 1;
                next[name] = value;
                continue;
            }
            next[name] = seal(value);
            changed = true;
        }
        if (!changed) continue;
        if (!dryRun) await db.update(mcpServers).set({ headers: next }).where(eq(mcpServers.id, row.id));
        result.mcpServers += 1;
    }

    for (const row of await db.select({ id: tools.id, config: tools.config }).from(tools)) {
        const config = row.config && typeof row.config === 'object' && !Array.isArray(row.config) ? row.config : null;
        const headers = config?.headers;
        if (!headers || typeof headers !== 'object' || Array.isArray(headers)) continue;
        const nextHeaders: Record<string, unknown> = { ...(headers as Record<string, unknown>) };
        let changed = false;
        for (const [name, rawValue] of Object.entries(nextHeaders)) {
            if (typeof rawValue !== 'string' || !rawValue) continue;
            if (isSealed(rawValue)) {
                result.skippedSealed += 1;
                continue;
            }
            nextHeaders[name] = seal(rawValue);
            changed = true;
        }
        if (!changed) continue;
        if (!dryRun) {
            await db
                .update(tools)
                .set({ config: { ...config, headers: nextHeaders } })
                .where(eq(tools.id, row.id));
        }
        result.tools += 1;
    }

    result.total = result.providers + result.storageConfigs + result.mcpServers + result.tools;
    return result;
}
