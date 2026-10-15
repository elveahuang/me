import { eq } from 'drizzle-orm';
import { createError } from 'h3';
import { projects } from '../db/schema';
import { db } from './db';
import { normalizeWorkId } from './work-input';

/**
 * 校验 projectId 引用：任务的 `project_id` 是带外键的 text 列，
 * 直接把客户端给的 id 塞进去时，不存在的父行会被 PostgreSQL 拒成 23503 → 500 并把 SQL 细节透出响应体。
 * 这里提前查一次父行，把「引用了不存在的项目」变成可读的 400。
 *
 * 单独成模块（而不是并入 work-input.ts）是因为它要连库，而 work-input.ts 保持纯函数好让冒烟测试直接断言。
 */
export async function assertProjectExists(raw: unknown): Promise<string | null> {
    if (raw === undefined || raw === null || raw === '') return null;
    const id = normalizeWorkId(raw, 'projectId');
    const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id));
    if (!row) throw createError({ statusCode: 400, statusMessage: 'projectId 指向的项目不存在' });
    return id;
}

/** 与 `db.transaction` 回调拿到的句柄兼容的最小集合（照搬 agent-skills.ts 的 DbRunner 写法）。 */
type ProjectTx = Pick<typeof db, 'select'>;

/**
 * 在写入事务内对父项目取 `FOR SHARE`，把「先查存在、后插入」的竞态窗口关死。
 *
 * 只在事务外查一次存在性是不够的：校验通过到 INSERT 之间项目可以被并发删除，
 * 外键随即把这条插入打成 23503，响应变成 500 且带出 SQL 原文（实测并发下 10 条全中）。
 * 父行上的 FOR SHARE 与并发子插入互相兼容（不牺牲吞吐），但与删除侧的 FOR UPDATE 冲突，
 * 于是新行要么排在删除之前，要么删除时已经能看到它（409），不存在第三种结局。
 * 锁内那次读顺带完成存在性判定，父行确实没了就回 400。
 */
export async function lockProjectRow(tx: ProjectTx, projectId: string | null): Promise<void> {
    if (!projectId) return;
    const [row] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for('share');
    if (!row) throw createError({ statusCode: 400, statusMessage: 'projectId 指向的项目不存在' });
}
