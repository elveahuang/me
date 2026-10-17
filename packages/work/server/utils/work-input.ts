import { createError } from 'h3';
import { NOTE_KINDS } from '../db/schema';
import { stripNull } from './pg-text';
import { UUID_PATTERN } from './route-id';

/**
 * 工作台表的入参归一。
 *
 * 与 admin-*-input 同一立场：这些值最后都会进 PostgreSQL 的 notNull 列或 text 列，
 * 少一步校验就是把 500 + SQL 细节回给界面；但更要紧的是 workbench 的字段会被读回给模型
 * （简报、笔记检索都直接拼提示词），所以长度、枚举、时间三类都在这里一次收口，
 * handler 里不再各写一份。
 *
 * 定时任务自己的入参（kind / HH:mm / 间隔 / 星期）在 `work-schedule.ts`——那里还有
 * 按北京日算下一次时刻的纯函数，与归一放同一文件更好读。
 */

export const WORK_TITLE_MAX = 200;
export const NOTE_CONTENT_MAX = 200_000;
export const WORK_TAG_MAX = 40;
export const WORK_TAG_COUNT_MAX = 20;

/** 时间戳列的合法区间：1970 年前与 2100 年后一律当作脏数据。 */
const MIN_TIMESTAMP_MS = Date.UTC(1970, 0, 1);
const MAX_TIMESTAMP_MS = Date.UTC(2100, 0, 1);

/** NUL 的处理规则与消费者见 `pg-text.ts`；这里的文本归一全部经过 `stripNull`。 */
function fail(status: number, message: string): never {
    throw createError({ statusCode: status, statusMessage: message });
}

/** 必填文本：非字符串、纯空白、超长都拒绝，返回 trim 后的值。 */
export function normalizeWorkText(raw: unknown, label: string, max: number): string {
    if (typeof raw !== 'string') fail(400, `${label}必须是字符串`);
    const value = stripNull(raw).trim();
    if (!value) fail(400, `${label}不能为空`);
    if (value.length > max) fail(400, `${label}最长 ${max} 个字符`);
    return value;
}

/** 选填文本：`undefined`/`null` 归一为空串（列是 notNull default ''），其余同必填校验。 */
export function normalizeWorkOptionalText(raw: unknown, label: string, max: number): string {
    if (raw === undefined || raw === null) return '';
    if (typeof raw !== 'string') fail(400, `${label}必须是字符串`);
    const value = stripNull(raw).trim();
    if (value.length > max) fail(400, `${label}最长 ${max} 个字符`);
    return value;
}

/**
 * 枚举列：未知值直接 400，不静默回退。
 * `status=one` 落库后列表筛不到、看板少一列，用户只会看到「任务凭空消失」，
 * 这比一次报错难查得多。
 */
export function normalizeWorkEnum<T extends string>(raw: unknown, allowed: readonly T[], label: string, fallback: T): T {
    if (raw === undefined || raw === null) return fallback;
    if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) {
        fail(400, `${label}只能是 ${allowed.join(' / ')}`);
    }
    return raw as T;
}

export function normalizeNoteKind(raw: unknown): (typeof NOTE_KINDS)[number] {
    return normalizeWorkEnum(raw, NOTE_KINDS, 'kind', 'note');
}

/**
 * 时间入参归一。接受 ISO 字符串或 epoch 毫秒，空值归一为 null（这些列都可空）。
 *
 * 夹区间而不是照收：定时任务的下一次时刻会被读回给模型也算「还有多久」，一个 1e18 的脏值会变成
 * 「距今约 3000 万年」并写进简报正文；`new Date('')` 又是 Invalid Date，
 * 落库时 postgres-js 会抛错变 500。
 */
export function normalizeWorkDate(raw: unknown, label: string): Date | null {
    if (raw === undefined || raw === null || raw === '') return null;
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? raw.trim() : null;
    if (value === null || (typeof value === 'string' && !value)) fail(400, `${label}必须是 ISO 时间字符串或毫秒时间戳`);
    if (typeof value === 'string') assertRealCalendarDay(value, label);
    const date = new Date(value as string | number);
    const ms = date.getTime();
    if (Number.isNaN(ms)) fail(400, `${label}不是合法时间`);
    if (ms < MIN_TIMESTAMP_MS || ms > MAX_TIMESTAMP_MS) fail(400, `${label}超出允许的时间范围`);
    return date;
}

/**
 * 不存在的日历日必须当场拒绝，不能让 `new Date()` 去「纠正」它。
 *
 * V8 对 `2026-02-30` 不报 Invalid Date，而是顺延成 `2026-03-02`（`2025-02-29` 同理变 03-01），
 * 于是模型给出的闰年/月末日期会静默变成另一天的时刻，界面上「写着 2 月 30 日、
 * 下一次却排在 3 月 2 日」，用户与简报都无从判断哪边是原始意图。
 * 只查 `YYYY-MM-DD` 前缀，带时区的完整 ISO 由日期部分决定合法性，不受解析偏移影响。
 */
function assertRealCalendarDay(value: string, label: string): void {
    const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!matched) return;
    const year = Number(matched[1]);
    const month = Number(matched[2]);
    const day = Number(matched[3]);
    if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
        fail(400, `${label}不是合法日期`);
    }
}

/**
 * 标签数组：形状错（非数组）拒绝，单个坏项只丢该项。
 *
 * 标量要字符串化而不是报错：标签后面会被助手工具写入，模型给出的 `2026` 是数字，
 * 为一个标签把整篇笔记的保存打成 400 会让用户以为「笔记存不上」。
 * 对象/数组/空串则直接丢弃——`JSON.stringify` 出来的标签只会污染筛选列表。
 */
export function normalizeWorkTags(raw: unknown): string[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) fail(400, 'tags 必须是字符串数组');
    const seen = new Set<string>();
    for (const item of raw) {
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
            const tag = stripNull(String(item)).trim().slice(0, WORK_TAG_MAX);
            if (tag) seen.add(tag);
        }
    }
    return [...seen].slice(0, WORK_TAG_COUNT_MAX);
}

/** 关联 id 入参：uuid 形状（服务端生成，客户端只回传），形状不对直接 400，省一次无谓查库。 */
export function normalizeWorkId(raw: unknown, label: string): string {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!UUID_PATTERN.test(value)) fail(400, `${label}不是合法的 id`);
    return value;
}
