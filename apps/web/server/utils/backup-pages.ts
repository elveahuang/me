import { and, asc, eq, gt, or, type SQL } from 'drizzle-orm';
import { getTableConfig, type PgColumn } from 'drizzle-orm/pg-core';
import { backupTables, dropHeaderValues } from './backup-builders';
import { db } from './db';

/**
 * NDJSON 单表游标分页（P3-5）。
 *
 * 游标是主键值的 JSON 数组，例如 `["2026-10-19T..."]` 或 `["conv_1", 42]`。
 * 为什么按主键而不是按 builder 的排序键：只有主键在所有表上都唯一且非空；
 * 按 `createdAt` 这类可重复的列做游标，同一毫秒的多行会在两页之间被跳过或重复。
 * 导出顺序与整表 builder 不同不影响备份内容——备份是按表还原的。
 */

export interface BackupPage {
    rows: Record<string, unknown>[];
    nextAfter: unknown[] | null;
    hasMore: boolean;
}

/** 与整表 builder 完全一致的脱敏口径；分页端点不能绕开它。 */
export function redactBackupRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
    if (table === 'providers') return { ...row, apiKey: '' };
    if (table === 'storageConfigs') return { ...row, secretAccessKey: '' };
    if (table === 'mcpServers') {
        const { headers, redactedHeaders } = dropHeaderValues(row.headers);
        return { ...row, headers, redactedHeaders };
    }
    if (table === 'tools') {
        const config = row.config && typeof row.config === 'object' && !Array.isArray(row.config) ? (row.config as Record<string, unknown>) : null;
        if (!config) return row;
        const { headers, redactedHeaders } = dropHeaderValues(config.headers);
        if (!redactedHeaders.length) return row;
        return { ...row, config: { ...config, headers }, redactedHeaders };
    }
    return row;
}

function primaryKeyColumns(table: string): PgColumn[] {
    const config = getTableConfig(backupTables[table]!);
    const columns = config.primaryKeys[0]?.columns ?? config.columns.filter((column) => column.primary);
    if (!columns.length) throw new Error(`备份表 ${table} 没有主键，无法游标分页`);
    return columns as PgColumn[];
}

function cursorCondition(columns: PgColumn[], values: unknown[]): SQL | undefined {
    const clauses: SQL[] = [];
    for (let index = 0; index < columns.length; index += 1) {
        const equals = columns.slice(0, index).map((column, before) => eq(column, values[before]));
        const greater = gt(columns[index]!, values[index]);
        const clause = and(...equals, greater);
        if (clause) clauses.push(clause);
    }
    return or(...clauses);
}

/**
 * 取一页。`after` 为空表示第一页；`limit+1` 用来判断是否还有下一页。
 * 游标值必须与主键列数一致，避免拿单列游标去查复合主键时静默跳行。
 */
export async function buildBackupPage(table: string, after: unknown[] | null, limit: number): Promise<BackupPage> {
    if (!backupTables[table]) throw new Error(`未知备份表：${table}`);
    const columns = primaryKeyColumns(table);
    if (after && after.length !== columns.length) throw new Error(`游标列数不匹配：${table} 需要 ${columns.length} 列`);
    const where = after ? cursorCondition(columns, after) : undefined;
    const rows = (await db
        .select()
        .from(backupTables[table]!)
        .where(where)
        .orderBy(...columns.map((column) => asc(column)))
        .limit(limit + 1)) as unknown as Record<string, unknown>[];

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map((row) => redactBackupRow(table, row));
    const last = page[page.length - 1];
    const nextAfter = last ? columns.map((column) => last[column.name] ?? null) : null;
    return { rows: page, nextAfter, hasMore };
}
