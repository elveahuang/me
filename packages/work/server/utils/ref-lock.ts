import { eq } from 'drizzle-orm';
import { createError } from 'h3';
import { agents, providers } from '../db/schema';
import { db } from './db';

/**
 * 外键父行的「锁内存在性判定」。
 *
 * 与 `work-project.ts` 的 `lockProjectRow()` 同一个道理，只是父表换成了智能体与供应商：
 * 「事务外先查一次父行存在 → 事务内插子行」这条写法在两次读之间有一个真实的窗口，
 * 窗口里父行可以被完整地删掉（删除走的是另一条连接、另一笔事务），于是子插入撞外键 23503，
 * 响应变成 500 且把 `Failed query: insert into "conversations" ("id", "agent_id", "title", ...)`
 * 连同整张列清单一起回给界面。`settings/agents/[id].ts` 的 DELETE 已经在事务里对智能体行
 * 取 FOR UPDATE，正是它挡住了「并发新建的会话绕过闸门被级联掉」；但插入侧没有对应的锁，
 * 只锁删除侧等于只关了一半的门。
 *
 * 锁内那次读顺带完成存在性判定：`FOR SHARE` 与删除侧的 `FOR UPDATE` 互斥、与并发子插入互相兼容
 * （不会牺牲吞吐），父行确实没了就回可读的 404/400，而不是让 PostgreSQL 替我们报错。
 */

/** 与 `db.transaction` 回调拿到的句柄兼容的最小集合（同 `agent-skills.ts` 的 DbRunner 写法）。 */
type LockRunner = Pick<typeof db, 'select'>;

/** 会话必须挂在仍在的智能体上（`conversations.agent_id` 外键为 cascade）。 */
export async function lockAgentRow(tx: LockRunner, agentId: string): Promise<void> {
    const [row] = await tx.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId)).for('share');
    if (!row) throw createError({ statusCode: 404, statusMessage: '智能体不存在' });
}

/** 智能体必须指向仍在的供应商（`agents.provider_id` 外键为 restrict，但 restrict 报错同样是 500 + SQL 原文）。 */
export async function lockProviderRow(tx: LockRunner, providerId: string): Promise<void> {
    const [row] = await tx.select({ id: providers.id }).from(providers).where(eq(providers.id, providerId)).for('share');
    if (!row) throw createError({ statusCode: 400, statusMessage: '模型供应商不存在，请重新选择' });
}
