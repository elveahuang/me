import { eq, sql } from 'drizzle-orm';
import { createError } from 'h3';
import { resolve } from 'node:path';
import { DEFAULT_SPACE_ID, spaces } from '../db/schema';
import { db } from './db';
import { isPathInside, parseLocalRoots } from './local-files';
import { stripNull } from './pg-text';
import { normalizeWorkId, normalizeWorkText } from './work-input';

/** 工作空间引用校验与默认空间初始化。 */

export { DEFAULT_SPACE_ID };

const SPACE_NAME_MAX = 60;
const SPACE_DESC_MAX = 500;
export const SPACE_INSTRUCTIONS_MAX = 4000;
const SPACE_ICON_MAX = 16;
const SPACE_LOCAL_ROOT_MAX = 500;

let spaceColumnsReady: Promise<void> | null = null;

async function ensureSpaceColumns(): Promise<void> {
    if (!spaceColumnsReady) {
        spaceColumnsReady = (async () => {
            try {
                await db.execute(sql`ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "default_agent_id" text`);
                await db.execute(sql`ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "local_root" text DEFAULT '' NOT NULL`);
            } catch {
                // 表尚未迁移创建时由后续迁移处理
            }
        })();
    }
    await spaceColumnsReady;
}

/**
 * 默认空间是迁移与首次启动的安全落点。
 *
 * 迁移已经插入同一行；这里再做一次幂等写入，覆盖「手工建库后直接启动」和
 * 「旧备份只恢复业务表」两种情况，避免创建会话时撞 space_id 外键。
 */
export async function ensureDefaultSpace(): Promise<void> {
    await ensureSpaceColumns();
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
    defaultAgentId: string | null;
    localRoot: string;
}

function normalizeSpaceLocalRoot(raw: unknown, fallback: string): string {
    if (raw === undefined) return fallback;
    if (raw === null) return '';
    if (typeof raw !== 'string') throw createError({ statusCode: 400, statusMessage: '本机工作目录必须是字符串' });
    const clean = stripNull(raw).trim();
    if (!clean) return '';
    if (clean.length > SPACE_LOCAL_ROOT_MAX) {
        throw createError({ statusCode: 400, statusMessage: `本机工作目录最长 ${SPACE_LOCAL_ROOT_MAX} 个字符` });
    }
    if (clean.split(/[\\/]+/).includes('..')) {
        throw createError({ statusCode: 400, statusMessage: '本机工作目录不允许包含 .. 路径穿越' });
    }
    const allowedRoots = parseLocalRoots();
    if (allowedRoots.length > 0) {
        const target = resolve(clean);
        if (!allowedRoots.some((root) => isPathInside(root, target))) {
            throw createError({ statusCode: 400, statusMessage: '本机工作目录必须位于 WORK_FILE_ROOTS 允许的目录范围内' });
        }
        return target;
    }
    return clean;
}

function normalizeSpaceDefaultAgentId(raw: unknown, fallback: string | null): string | null {
    if (raw === undefined) return fallback;
    if (raw === null || raw === '') return null;
    return normalizeWorkId(raw, 'defaultAgentId');
}

/** 表单入参归一；允许 PATCH 只传部分字段时由调用方合并旧值。 */
export function normalizeSpaceInput(
    raw: Record<string, unknown>,
    existing?: Partial<SpaceInput> & Pick<SpaceInput, 'name' | 'description' | 'icon' | 'instructions'>,
): SpaceInput {
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
        defaultAgentId: normalizeSpaceDefaultAgentId(raw.defaultAgentId, existing?.defaultAgentId ?? null),
        localRoot: normalizeSpaceLocalRoot(raw.localRoot, existing?.localRoot ?? ''),
    };
}
