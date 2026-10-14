import { createError } from 'h3';

/**
 * 管理端 agents 资源的入参归一。
 * 非字符串塞 text 列、非数字塞 real/integer 列、非布尔塞 boolean 列都会被
 * PostgreSQL 拒成 500 并把 SQL 细节透出响应体；创建/编辑统一先校验再写库。
 * name 规则对齐 skills/tools：trim 后非空、限长 100。
 */

export function normalizeAgentName(raw: unknown): string {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) throw createError({ statusCode: 400, statusMessage: 'name 必填' });
    if (name.length > 100) throw createError({ statusCode: 400, statusMessage: 'name 过长（最多 100 字符）' });
    return name;
}

/** 文本列通用校验：缺失回退 fallback，非字符串拒绝，超长拒绝（截断 prompt 比报错更糟） */
export function normalizeAgentText(raw: unknown, label: string, maxChars: number): string | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'string') throw createError({ statusCode: 400, statusMessage: `${label} 必须为字符串` });
    if (raw.length > maxChars) throw createError({ statusCode: 400, statusMessage: `${label} 过长（最多 ${maxChars} 字符）` });
    return raw;
}

export function normalizeAgentModel(raw: unknown): string {
    const model = typeof raw === 'string' ? raw.trim() : raw === undefined || raw === null ? '' : null;
    if (model === null) throw createError({ statusCode: 400, statusMessage: 'model 必须为字符串' });
    if (!model) return 'deepseek-chat';
    if (model.length > 100) throw createError({ statusCode: 400, statusMessage: 'model 过长（最多 100 字符）' });
    return model;
}

/** 浏览器 number 输入被清空时 v-model.number 会留下 ''，与各列缺省语义等价 */
export function normalizeAgentTemperature(raw: unknown, fallback: number): number {
    if (raw === undefined || raw === null || raw === '') return fallback;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw createError({ statusCode: 400, statusMessage: 'temperature 必须为有限数字' });
    return Math.min(2, Math.max(0, raw));
}

/** maxTokens 列可空：缺失/显式 null/清空都回退 null（PATCH 传 null 即清空） */
export function normalizeAgentMaxTokens(raw: unknown): number | null {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw createError({ statusCode: 400, statusMessage: 'maxTokens 必须为有限数字' });
    return Math.min(1_000_000, Math.max(1, Math.floor(raw)));
}

export function normalizeAgentMaxSteps(raw: unknown, fallback: number): number {
    if (raw === undefined || raw === null || raw === '') return fallback;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw createError({ statusCode: 400, statusMessage: 'maxSteps 必须为有限数字' });
    return Math.min(50, Math.max(1, Math.floor(raw)));
}

/** 一次请求最多能提交的绑定项数：绑定量级本就是个位数到几十，超大列表只会把 inArray 的参数撑爆（PG 上限 65535） */
const AGENT_ID_LIST_MAX = 500;

/**
 * 能力绑定 id 列表（skillIds/toolIds/kbIds/mcpIds）的归一。
 *
 * 这些值会被直接交给 inArray()：字符串能过 handler 里的 truthiness 门（"abc".length 也是真），
 * 非字符串元素则会作为标量参数进 SQL —— 两者都是 500 并透出 SQL 细节。这里统一收敛为去重后的字符串数组。
 */
export function normalizeAgentIdList(raw: unknown, label: string): string[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw createError({ statusCode: 400, statusMessage: `${label} 必须为数组` });
    if (raw.length > AGENT_ID_LIST_MAX) throw createError({ statusCode: 400, statusMessage: `${label} 过多（最多 ${AGENT_ID_LIST_MAX} 项）` });
    const ids = new Set<string>();
    for (const item of raw) {
        // 而不是静默丢弃：客户端把 id 传错类型应当当场报错，静默丢会留下「以为绑上了」的空绑定
        if (typeof item !== 'string') throw createError({ statusCode: 400, statusMessage: `${label} 只能包含字符串` });
        const id = item.trim();
        if (id) ids.add(id);
    }
    return [...ids];
}
