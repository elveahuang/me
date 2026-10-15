import { eq, sql } from 'drizzle-orm';
import { projects } from '../../db/schema';
import { normalizeAdminBoolean } from '../../utils/admin-boolean';
import { db } from '../../utils/db';
import { requireMethod } from '../../utils/method';
import { capBody } from '../../utils/request-body';
import { PROJECT_COLOR_MAX, PROJECT_DESCRIPTION_MAX, PROJECT_NAME_MAX, normalizeWorkOptionalText, normalizeWorkText } from '../../utils/work-input';

export default defineEventHandler(async (event) => {
    await capBody(event);
    const method = requireMethod(event, ['GET', 'PATCH', 'DELETE']);
    const id = getRouterParam(event, 'id')!;

    if (method === 'DELETE') {
        // 三张子表的 project_id 是 `set null`：直接删会让「项目下的任务」静默散成「无项目」，
        // 用户既没有撤销也数不清原来挂在哪儿，而 `archived` 才是这个场景该有的动作。
        // 先数引用再删必须放在同一事务里并对项目行 FOR UPDATE——外键插入会在父行上取
        // KEY SHARE 锁，因此并发新建的任务要么被这次计数查到，要么排到删除之后。
        // 锁与三个计数合成一条 SELECT：分成两次读的话，行锁那次 SELECT 不带任何业务字段，
        // 合并后既少一次往返，也让「行存在性」与「引用数」来自同一个快照。
        // 子查询里必须绑 `${id}` 而不是相关引用 `${projects.id}`——drizzle 在目标清单里会把
        // 列渲染成不带表名限定的 `"id"`，而子查询自己的 FROM 是 tasks/notes/events，
        // 于是它绑到子查询那侧的同名列，计数恒为 0，守卫静默失效（实测删掉了带任务的项目）。
        await db.transaction(async (tx) => {
            const [target] = await tx
                .select({
                    id: projects.id,
                    tasks: sql<number>`(select count(*)::int from tasks where project_id = ${id})`.as('tasks'),
                    notes: sql<number>`(select count(*)::int from notes where project_id = ${id})`.as('notes'),
                    events: sql<number>`(select count(*)::int from events where project_id = ${id})`.as('events'),
                })
                .from(projects)
                .where(eq(projects.id, id))
                .for('update');
            if (!target) throw createError({ statusCode: 404, statusMessage: '项目不存在' });

            const total = target.tasks + target.notes + target.events;
            if (total) {
                throw createError({
                    statusCode: 409,
                    statusMessage: `项目下还有 ${target.tasks} 条任务、${target.notes} 条笔记、${target.events} 条日程，请先把它们移出去或改用归档`,
                });
            }
            await tx.delete(projects).where(eq(projects.id, id));
        });
        return { ok: true };
    }

    if (method === 'GET') {
        const [row] = await db.select().from(projects).where(eq(projects.id, id));
        if (!row) throw createError({ statusCode: 404, statusMessage: '项目不存在' });
        return row;
    }

    const body = (await readBody(event)) ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = normalizeWorkText(body.name, 'name', PROJECT_NAME_MAX);
    if (body.description !== undefined) patch.description = normalizeWorkOptionalText(body.description, 'description', PROJECT_DESCRIPTION_MAX);
    if (body.color !== undefined) patch.color = normalizeWorkOptionalText(body.color, 'color', PROJECT_COLOR_MAX);
    if (body.archived !== undefined) patch.archived = normalizeAdminBoolean(body.archived, 'archived', false);

    // 更新与「存在性」判定合成一次查询：先 update 后 select 的写法在并发删除下会把 404 报成成功
    const [row] = await db.update(projects).set(patch).where(eq(projects.id, id)).returning();
    if (!row) throw createError({ statusCode: 404, statusMessage: '项目不存在' });
    return row;
});
