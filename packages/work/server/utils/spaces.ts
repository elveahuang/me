import { eq } from 'drizzle-orm';
import { createError } from 'h3';
import { DEFAULT_SPACE_ID, spaces } from '../db/schema';
import { db } from './db';
import { stripNull } from './pg-text';
import { normalizeWorkId, normalizeWorkText } from './work-input';

/** 工作空间引用校验与默认空间初始化。 */

export { DEFAULT_SPACE_ID };

const SPACE_NAME_MAX = 60;
const SPACE_DESC_MAX = 500;
const SPACE_INSTRUCTIONS_MAX = 4000;
const SPACE_ICON_MAX = 16;

/**
 * 默认空间是迁移与首次启动的安全落点。
 *
 * 迁移已经插入同一行；这里再做一次幂等写入，覆盖「手工建库后直接启动」和
 * 「旧备份只恢复业务表」两种情况，避免创建会话时撞 space_id 外键。
 */
export async function ensureDefaultSpace(): Promise<void> {
    await db
        .insert(spaces)
        .values({
            id: DEFAULT_SPACE_ID,
            name: '默认空间',
            description: '会话、资料与自动化的默认工作上下文',
            icon: '🗂️',
        })
        .onConflictDoNothing();
}

/** 可选空间：空值表示独立对话 / 全局资料 / 全局自动化，非空时做存在性校验。 */
export async function resolveOptionalSpaceId(raw: unknown): Promise<string | null> {
    if (raw === undefined || raw === null || raw === '') return null;
    return resolveSpaceId(raw);
}

/** 新建会话或查询筛选使用：空值落到默认空间，非法 id 回 400。 */
export async function resolveSpaceId(raw: unknown): Promise<string> {
    if (raw === undefined || raw === null || raw === '') {
        await ensureDefaultSpace();
        return DEFAULT_SPACE_ID;
    }
    const id = raw === DEFAULT_SPACE_ID ? DEFAULT_SPACE_ID : normalizeWorkId(raw, 'spaceId');
    await ensureDefaultSpace();
    const [row] = await db.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, id));
    if (!row) throw createError({ statusCode: 400, statusMessage: 'spaceId 指向的工作空间不存在' });
    return id;
}

export interface SpaceInput {
    name: string;
    description: string;
    icon: string;
    instructions: string;
}

/** 表单入参归一；允许 PATCH 只传部分字段时由调用方合并旧值。 */
export function normalizeSpaceInput(raw: Record<string, unknown>, existing?: SpaceInput): SpaceInput {
    const text = (value: unknown, fallback: string, label: string, max: number) => {
        if (value === undefined) return fallback;
        if (typeof value !== 'string') throw createError({ statusCode: 400, statusMessage: `${label}必须是字符串` });
        const clean = stripNull(value).trim();
        if (label === '名称' && !clean) throw createError({ statusCode: 400, statusMessage: '名称不能为空' });
        if (clean.length > max) throw createError({ statusCode: 400, statusMessage: `${label}最长 ${max} 个字符` });
        return clean;
    };

    return {
        name: normalizeWorkText(raw.name ?? existing?.name, '名称', SPACE_NAME_MAX),
        description: text(raw.description, existing?.description ?? '', '描述', SPACE_DESC_MAX),
        icon: text(raw.icon, existing?.icon ?? '🗂️', '图标', SPACE_ICON_MAX) || '🗂️',
        instructions: text(raw.instructions, existing?.instructions ?? '', '空间指令', SPACE_INSTRUCTIONS_MAX),
    };
}
