import { createError } from 'h3';
import {
    agentKnowledgeBases,
    agentMcpServers,
    agentSkills,
    agentTools,
    agents,
    attachments,
    automationRuns,
    conversations,
    kbDocuments,
    knowledgeBases,
    mcpServers,
    messages,
    providers,
    schedules,
    skills,
    spaces,
    storageConfigs,
    systemSettings,
    tools,
} from '../db/schema';
import { db } from './db';
import { ensureDefaultSpace } from './spaces';

export interface BackupImportResult {
    inserted: Record<string, number>;
    skipped: Record<string, number>;
    warnings: string[];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const MAX_ROWS_PER_TABLE = 200_000;
const MAX_SYSTEM_SETTINGS_BYTES = 64 * 1024;

const DATE_COLUMNS: Record<string, string[]> = {
    spaces: ['createdAt', 'updatedAt'],
    providers: ['createdAt', 'updatedAt'],
    skills: ['createdAt', 'updatedAt'],
    tools: ['createdAt', 'updatedAt'],
    mcpServers: ['createdAt', 'updatedAt'],
    knowledgeBases: ['createdAt', 'updatedAt'],
    storageConfigs: ['createdAt', 'updatedAt'],
    agents: ['createdAt', 'updatedAt'],
    conversations: ['createdAt', 'updatedAt'],
    schedules: ['startsAt', 'nextRunAt', 'lastRunAt', 'createdAt', 'updatedAt'],
    kbDocuments: ['createdAt'],
    messages: ['createdAt'],
    automationRuns: ['scheduledFor', 'startedAt', 'finishedAt', 'createdAt'],
    attachments: ['createdAt'],
    systemSettings: ['updatedAt'],
};

function rowsOf(data: Record<string, unknown>, key: string): Record<string, unknown>[] {
    const value = data[key];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw createError({ statusCode: 400, statusMessage: `备份字段 ${key} 必须是数组` });
    if (value.length > MAX_ROWS_PER_TABLE) throw createError({ statusCode: 400, statusMessage: `备份字段 ${key} 行数过多` });
    return value.map((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw createError({ statusCode: 400, statusMessage: `备份字段 ${key} 含非法行` });
        return row as Record<string, unknown>;
    });
}

/** JSON 里的 timestamp 是字符串；drizzle 的 timestamp 列需要 Date。 */
function reviveRows(key: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
    const dateKeys = DATE_COLUMNS[key] ?? [];
    return rows.map((row) => {
        const copy = { ...row };
        for (const field of dateKeys) {
            if (typeof copy[field] === 'string' && copy[field]) {
                const date = new Date(copy[field] as string);
                if (Number.isNaN(date.getTime())) throw createError({ statusCode: 400, statusMessage: `备份字段 ${key}.${field} 不是合法时间` });
                copy[field] = date;
            }
        }
        // messages.seq 是 bigserial；导入时让序列自己生成，避免与现有序列冲突。
        if (key === 'messages') delete copy.seq;
        return copy;
    });
}

async function importRows(tx: Tx, key: string, table: any, data: Record<string, unknown>, result: BackupImportResult): Promise<void> {
    const rows = reviveRows(key, rowsOf(data, key));
    if (!rows.length) {
        result.inserted[key] = 0;
        result.skipped[key] = 0;
        return;
    }
    const inserted = await tx
        .insert(table)
        .values(rows as any)
        .onConflictDoNothing()
        .returning();
    result.inserted[key] = inserted.length;
    result.skipped[key] = rows.length - inserted.length;
}

/**
 * 导入 `GET /api/export` 生成的备份。
 *
 * 采用合并语义：同主键行跳过，不覆盖现有数据。顺序按外键依赖排列；
 * 任何一步失败都会回滚整个事务。密钥在导出时已被清空，导入后需要重新填写。
 */
export async function importWorkBackup(payload: unknown): Promise<BackupImportResult> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw createError({ statusCode: 400, statusMessage: '备份文件必须是 JSON 对象' });
    }
    const body = payload as Record<string, unknown>;
    if (body.format !== 'work.backup') throw createError({ statusCode: 400, statusMessage: '不是 work 备份文件' });
    if (body.version !== 1) throw createError({ statusCode: 400, statusMessage: '不支持的备份版本' });
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
        throw createError({ statusCode: 400, statusMessage: '备份缺少 data 对象' });
    }

    const data = body.data as Record<string, unknown>;
    const result: BackupImportResult = { inserted: {}, skipped: {}, warnings: [] };
    const settings = data.systemSettings;
    if (settings !== null && settings !== undefined) {
        if (typeof settings !== 'object' || Array.isArray(settings)) throw createError({ statusCode: 400, statusMessage: 'systemSettings 必须是对象或 null' });
        if (JSON.stringify(settings).length > MAX_SYSTEM_SETTINGS_BYTES) throw createError({ statusCode: 400, statusMessage: 'systemSettings 过大' });
    }

    await ensureDefaultSpace();

    try {
        await db.transaction(async (tx) => {
            await importRows(tx, 'spaces', spaces, data, result);
            await importRows(tx, 'providers', providers, data, result);
            await importRows(tx, 'skills', skills, data, result);
            await importRows(tx, 'tools', tools, data, result);
            await importRows(tx, 'mcpServers', mcpServers, data, result);
            await importRows(tx, 'knowledgeBases', knowledgeBases, data, result);
            await importRows(tx, 'storageConfigs', storageConfigs, data, result);
            await importRows(tx, 'agents', agents, data, result);
            await importRows(tx, 'conversations', conversations, data, result);
            await importRows(tx, 'schedules', schedules, data, result);
            await importRows(tx, 'kbDocuments', kbDocuments, data, result);
            await importRows(tx, 'messages', messages, data, result);
            await importRows(tx, 'automationRuns', automationRuns, data, result);
            await importRows(tx, 'agentSkills', agentSkills, data, result);
            await importRows(tx, 'agentTools', agentTools, data, result);
            await importRows(tx, 'agentMcpServers', agentMcpServers, data, result);
            await importRows(tx, 'agentKnowledgeBases', agentKnowledgeBases, data, result);
            await importRows(tx, 'attachments', attachments, data, result);

            if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
                const revived = reviveRows('systemSettings', [settings as Record<string, unknown>])[0]!;
                const inserted = await tx
                    .insert(systemSettings)
                    .values(revived as any)
                    .onConflictDoNothing()
                    .returning();
                result.inserted.systemSettings = inserted.length;
                result.skipped.systemSettings = inserted.length ? 0 : 1;
            } else {
                result.inserted.systemSettings = 0;
                result.skipped.systemSettings = 0;
            }
        });
    } catch (error) {
        console.error('[import] 备份导入失败:', error);
        throw createError({ statusCode: 400, statusMessage: '备份导入失败：引用的数据不完整或格式不兼容' });
    }

    result.warnings.push('供应商与存储密钥不会从备份恢复，请到设置页重新填写。');
    result.warnings.push('知识库只导入了文档正文，向量索引需要重新构建。');
    result.warnings.push('附件二进制不在备份中，需另行恢复对象存储的桶。');
    return result;
}
