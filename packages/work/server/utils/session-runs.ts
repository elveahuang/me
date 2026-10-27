import { and, eq, gt } from 'drizzle-orm';
import { createError } from 'h3';
import { sessionRuns, type SessionRunStatus } from '../db/schema';
import { db } from './db';

/** postgres-js 的唯一约束错误（SQLSTATE 23505），可能被包在 cause 链里。 */
function isUniqueViolation(error: unknown): boolean {
    let current: unknown = error;
    for (let depth = 0; depth < 4 && current; depth++) {
        if (typeof current === 'object' && (current as { code?: unknown }).code === '23505') return true;
        current = (current as { cause?: unknown }).cause;
    }
    return false;
}

/**
 * 会话运行台账：把「哪段会话正在生成」从进程内存搬到数据库。
 *
 * 为什么需要第二份权威：`chat-runs.ts` 的 Map 只在一个 Nitro 进程活着时有效。进程重启/崩溃后，
 * 库里会留下永远 `running` 的行，而侧栏只能问内存——两边都答不出「上一轮到底是死了还是还在跑」。
 * 这张表不存正文（正文仍落 `messages`），只记生命周期，所以体积可控，也可以随整机备份导出。
 *
 * 单主本机应用的前提：同一时刻只有一个服务进程。启动时把所有遗留的 `running` 标成 `interrupted`
 * 是安全的；将来若真的多进程部署，这里要改成「按进程实例 id 清理自己那一批」。
 */

/** 与 chat-runs 的 RUN_STALE_MS 同量级：超过这个时长仍未收尾的库行不再当作在途 */
const RUN_DB_STALE_MS = 10 * 60_000;

export interface StartSessionRunInput {
    conversationId: string;
    trigger?: 'chat' | 'schedule';
    requestId?: string;
}

/**
 * 开一条运行记录。返回 null 表示台账写入失败——调用方必须继续生成，
 * 不能因为一条旁路记录把整轮对话变成 500。
 */
export async function startSessionRun(input: StartSessionRunInput): Promise<string | null> {
    const id = crypto.randomUUID();
    try {
        await db.insert(sessionRuns).values({
            id,
            conversationId: input.conversationId,
            trigger: input.trigger ?? 'chat',
            requestId: input.requestId ?? '',
            status: 'running',
        });
        return id;
    } catch (error) {
        // P3-1：同会话 + 同 requestId 的并发请求可能同时通过应用层预检，唯一索引是最后一道闸门。
        // 这类冲突必须变成 409，不能按「台账写失败」吞掉——否则两个请求会各调一次模型。
        if (isUniqueViolation(error)) {
            throw createError({
                statusCode: 409,
                statusMessage: '同一 requestId 正在处理中',
                data: { code: 'conflict', duplicate: true, clientRequestId: input.requestId ?? '' },
            });
        }
        console.error('[session-runs] 写入运行记录失败（不影响本轮生成）:', error);
        return null;
    }
}

/** 收尾一条运行记录；只更新仍为 running 的行，重复收尾是幂等空操作。 */
export async function finishSessionRun(id: string | null, status: Exclude<SessionRunStatus, 'running'>, errorCode?: string | null): Promise<void> {
    if (!id) return;
    try {
        await db
            .update(sessionRuns)
            .set({ status, finishedAt: new Date(), errorCode: errorCode ?? null })
            .where(and(eq(sessionRuns.id, id), eq(sessionRuns.status, 'running')));
    } catch (error) {
        console.error('[session-runs] 收尾运行记录失败:', error);
    }
}

export interface InterruptedSessionRun {
    id: string;
    conversationId: string;
}

/**
 * 启动清理：进程刚起时不可能有本进程发起的在途轮次，遗留的 `running` 都是上次崩溃/重启的残行。
 * 标记为 `interrupted` 而不是删除，保留「这一轮没跑完」的可解释性。
 *
 * 返回被标记的行（而不是只返回数量）：调用方要按会话补工具结果，不能只改台账状态。
 */
export async function markInterruptedSessionRuns(): Promise<InterruptedSessionRun[]> {
    try {
        const rows = await db
            .update(sessionRuns)
            .set({ status: 'interrupted', finishedAt: new Date(), errorCode: 'process_restart' })
            .where(eq(sessionRuns.status, 'running'))
            .returning({ id: sessionRuns.id, conversationId: sessionRuns.conversationId });
        if (rows.length) console.info(`[session-runs] 启动清理：${rows.length} 条遗留 running 已标记为 interrupted`);
        return rows;
    } catch (error) {
        // 启动时数据库可能还没就绪；只记日志，不能阻止应用启动。
        console.error('[session-runs] 启动清理失败（将在下次启动重试）:', error);
        return [];
    }
}

/** 库里仍在途的会话 id（只取近期行，避免历史脏数据永久显示「生成中」）。 */
export async function runningSessionRunConversationIds(): Promise<string[]> {
    try {
        const rows = await db
            .selectDistinct({ conversationId: sessionRuns.conversationId })
            .from(sessionRuns)
            .where(and(eq(sessionRuns.status, 'running'), gt(sessionRuns.startedAt, new Date(Date.now() - RUN_DB_STALE_MS))));
        return rows.map((row) => row.conversationId);
    } catch (error) {
        console.error('[session-runs] 读取在途列表失败:', error);
        return [];
    }
}
