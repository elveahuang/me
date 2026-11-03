import { createError } from 'h3';
import { createHash } from 'node:crypto';
import { backupTables } from './backup-builders';
import { importWorkBackup, type BackupImportResult } from './backup-import';

/**
 * NDJSON 备份导入（P3-5）。
 *
 * 导出格式是 `meta → (table → row* → tableEnd)* → end(checksum)`；这里把它重新组装成
 * `importWorkBackup()` 认识的 JSON 形状，复用同一套合并语义、外键顺序和单事务。
 *
 * 刻意只接受**整机**导出（`meta.mode === 'all'`）：单表分页的 `tableEnd.nextAfter`
 * 代表「后面还有」，把它当整份备份导入会静默丢数据；需要单表恢复时应导出整份。
 * 校验和按导出时的行负载重新计算（`{type:'row',table,row}` + `\n`），所以截断/改行都会 400。
 */

const SUPPORTED_BACKUP_VERSIONS = new Set([1, 2, 3, 4, 5]);

export interface NdjsonImportSummary extends BackupImportResult {
    tables: number;
    rows: number;
}

function bad(message: string) {
    return createError({ statusCode: 400, statusMessage: message });
}

export function parseNdjsonBackup(text: string): { payload: Record<string, unknown>; tables: number; rows: number } {
    const lines = text.split(/\r?\n/);
    let meta: Record<string, unknown> | null = null;
    let currentTable: string | null = null;
    let currentRows: Record<string, unknown>[] = [];
    let expectedRows = 0;
    let ended = false;
    let checksum = '';
    const data: Record<string, unknown> = {};
    let tableCount = 0;
    let rowCount = 0;

    for (let index = 0; index < lines.length; index++) {
        const raw = lines[index]!;
        if (!raw.trim()) continue;
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw bad(`NDJSON 第 ${index + 1} 行不是合法 JSON`);
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw bad(`NDJSON 第 ${index + 1} 行不是对象`);
        const event = parsed as Record<string, unknown>;
        const type = event.type;

        if (!meta) {
            if (type !== 'meta') throw bad('NDJSON 备份必须以 meta 行开头');
            if (event.format !== 'work.backup.ndjson') throw bad('不是 work NDJSON 备份');
            if (event.mode !== 'all') throw bad('只能导入整机 NDJSON 备份；单表分片缺少其余表');
            const version = Number(event.backupVersion);
            if (!SUPPORTED_BACKUP_VERSIONS.has(version)) throw bad('不支持的备份版本');
            meta = event;
            continue;
        }

        if (type === 'table') {
            if (ended) throw bad('NDJSON 在 end 之后仍有数据');
            if (currentTable) throw bad(`表 ${currentTable} 尚未结束就开始了新表`);
            const table = event.table;
            if (typeof table !== 'string' || !Object.hasOwn(backupTables, table)) throw bad(`未知的备份表：${String(table)}`);
            if (Object.hasOwn(data, table)) throw bad(`NDJSON 重复出现表 ${table}`);
            currentTable = table;
            currentRows = [];
            expectedRows = 0;
            continue;
        }

        if (type === 'row') {
            if (!currentTable) throw bad('row 出现在 table 行之前');
            if (event.table !== currentTable) throw bad(`row.table 与当前表 ${currentTable} 不匹配`);
            const row = event.row;
            if (!row || typeof row !== 'object' || Array.isArray(row)) throw bad(`表 ${currentTable} 含非法行`);
            currentRows.push(row as Record<string, unknown>);
            expectedRows++;
            continue;
        }

        if (type === 'tableEnd') {
            if (!currentTable) throw bad('tableEnd 出现在 table 行之前');
            if (event.table !== currentTable) throw bad(`tableEnd.table 与当前表 ${currentTable} 不匹配`);
            const count = Number(event.count);
            if (count !== expectedRows) throw bad(`表 ${currentTable} 行数与 tableEnd 不一致`);
            // systemSettings 在 JSON 备份里是单例对象，NDJSON 为了「表 = 行集合」包了一层
            data[currentTable] = currentTable === 'systemSettings' ? (currentRows[0] ?? null) : currentRows;
            tableCount++;
            rowCount += currentRows.length;
            currentTable = null;
            currentRows = [];
            expectedRows = 0;
            continue;
        }

        if (type === 'end') {
            if (currentTable) throw bad(`表 ${currentTable} 缺少 tableEnd`);
            if (typeof event.checksum !== 'string' || !event.checksum) throw bad('NDJSON 缺少 end.checksum');
            checksum = event.checksum;
            ended = true;
            continue;
        }

        throw bad(`未知的 NDJSON 事件类型：${String(type)}`);
    }

    if (!meta) throw bad('NDJSON 备份为空');
    if (!ended) throw bad('NDJSON 备份不完整（缺少 end 行）');
    if (currentTable) throw bad(`表 ${currentTable} 缺少 tableEnd`);

    // 按导出时的行负载重算：字段顺序固定为 type/table/row，与 ndjson.get.ts 的 line() 一致
    const digest = createHash('sha256');
    let recomputedRows = 0;
    for (const [table, value] of Object.entries(data)) {
        const rows = table === 'systemSettings' ? (value === null ? [] : [value]) : (value as Record<string, unknown>[]);
        for (const row of rows) {
            digest.update(`${JSON.stringify({ type: 'row', table, row })}\n`);
            recomputedRows++;
        }
    }
    if (recomputedRows !== rowCount) throw bad('NDJSON 行数统计不一致');
    if (digest.digest('hex') !== checksum) throw bad('NDJSON 校验和不匹配，文件可能被截断或修改');

    return {
        payload: { format: 'work.backup', version: Number(meta.backupVersion), data },
        tables: tableCount,
        rows: rowCount,
    };
}

export async function importNdjsonBackup(text: string): Promise<NdjsonImportSummary> {
    const parsed = parseNdjsonBackup(text);
    const result = await importWorkBackup(parsed.payload);
    return { ...result, tables: parsed.tables, rows: parsed.rows };
}
