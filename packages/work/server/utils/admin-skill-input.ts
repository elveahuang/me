import { createError } from 'h3';

/**
 * 管理端 skills 资源的入参归一（POST 与 PATCH 共用一份规则）。
 *
 * 此前只有 name 做了校验，description/instructions 直传、enabled 不做类型检查：
 * 非字符串塞 text 列、非布尔塞 boolean 列都会被 PostgreSQL 拒成 500 并把 SQL 细节透出响应体。
 * instructions 另有长度上限——它会原样注入智能体的系统提示词，不设上限等于让一次表单提交撑爆上下文。
 */
const SKILL_NAME_MAX = 100;
export const SKILL_DESCRIPTION_MAX = 500;
export const SKILL_INSTRUCTIONS_MAX = 20_000;

export function normalizeSkillName(raw: unknown): string {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) throw createError({ statusCode: 400, statusMessage: 'name 必填' });
    if (name.length > SKILL_NAME_MAX) throw createError({ statusCode: 400, statusMessage: `name 过长（最多 ${SKILL_NAME_MAX} 字符）` });
    return name;
}

/** 文本列：非字符串拒绝（静默转空串等于覆盖掉原有内容），超长拒绝而不是截断 */
export function normalizeSkillText(raw: unknown, label: string, maxChars: number): string {
    if (typeof raw !== 'string') throw createError({ statusCode: 400, statusMessage: `${label} 必须为字符串` });
    if (raw.length > maxChars) throw createError({ statusCode: 400, statusMessage: `${label} 过长（最多 ${maxChars} 字符）` });
    return raw;
}
