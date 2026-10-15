import { asc, eq, sql } from 'drizzle-orm';
import { projects } from '../db/schema';
import { normalizeAdminBoolean } from '../utils/admin-boolean';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { flagParam, stringParam } from '../utils/query';
import { capBody } from '../utils/request-body';
import { PROJECT_COLOR_MAX, PROJECT_DESCRIPTION_MAX, PROJECT_NAME_MAX, normalizeWorkOptionalText, normalizeWorkText } from '../utils/work-input';

/**
 * 项目：列表与新建。
 *
 * `?archived=` 不传返回全部（今日总览与任务分组都要能看到归档项目的历史条目），
 * 传 `active`/`only` 由服务端筛，避免客户端把整表拉回去再 filter。
 * `?stats=1` 额外带出每个项目的任务/笔记/日程计数，供项目页显示进度。
 */
export default defineEventHandler(async (event) => {
    await capBody(event);
    const method = requireMethod(event, ['GET', 'POST']);

    if (method === 'POST') {
        const body = (await readBody(event)) ?? {};
        const id = crypto.randomUUID();
        await db.insert(projects).values({
            id,
            name: normalizeWorkText(body.name, 'name', PROJECT_NAME_MAX),
            description: normalizeWorkOptionalText(body.description, 'description', PROJECT_DESCRIPTION_MAX),
            color: normalizeWorkOptionalText(body.color, 'color', PROJECT_COLOR_MAX),
            archived: normalizeAdminBoolean(body.archived, 'archived', false),
        });
        const [row] = await db.select().from(projects).where(eq(projects.id, id));
        return row;
    }

    // 走 stringParam 而不是裸解构：`?archived=active&archived=only` 会让 h3 给出数组，
    // 数组跟任何字面量都不相等，于是「只看归档」这种筛选被静默取消、返回整张表，
    // 客户端看到的是一次毫无作用的点击。
    const archived = stringParam(getQuery(event).archived);
    const where =
        archived === 'active' || archived === 'false'
            ? eq(projects.archived, false)
            : archived === 'only' || archived === 'true'
              ? eq(projects.archived, true)
              : undefined;

    if (!flagParam(getQuery(event).stats)) {
        return db.select().from(projects).where(where).orderBy(asc(projects.createdAt));
    }

    // 计数用相关子查询而不是三次 JOIN + GROUP BY：项目是本机数据（几十条量级），
    // 每行三次走 project_id 索引的 count 比把三张表聚合再回填更简单，也不会因为
    // 某个项目没有任务就从结果里整行消失（JOIN + GROUP BY 必须再 LEFT JOIN 回来）。
    const countOf = (table: string, predicate: string) =>
        sql<number>`(select count(*)::int from ${sql.raw(table)} where project_id = ${projects.id}${sql.raw(predicate)})`;
    const rows = await db
        .select({
            project: projects,
            openTasks: countOf('tasks', ` and status in ('todo','doing')`).as('openTasks'),
            doneTasks: countOf('tasks', ` and status = 'done'`).as('doneTasks'),
            noteCount: countOf('notes', '').as('noteCount'),
            eventCount: countOf('events', '').as('eventCount'),
        })
        .from(projects)
        .where(where)
        .orderBy(asc(projects.createdAt));

    return rows.map((row) => ({
        ...row.project,
        openTasks: Number(row.openTasks),
        doneTasks: Number(row.doneTasks),
        noteCount: Number(row.noteCount),
        eventCount: Number(row.eventCount),
    }));
});
