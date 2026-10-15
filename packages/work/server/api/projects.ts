import { asc, eq } from 'drizzle-orm';
import { projects } from '../db/schema';
import { normalizeAdminBoolean } from '../utils/admin-boolean';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { capBody } from '../utils/request-body';
import { PROJECT_COLOR_MAX, PROJECT_DESCRIPTION_MAX, PROJECT_NAME_MAX, normalizeWorkOptionalText, normalizeWorkText } from '../utils/work-input';

/**
 * 项目：列表与新建。
 *
 * `?archived=` 不传返回全部（今日总览与任务分组都要能看到归档项目的历史条目），
 * 传 `active`/`only` 由服务端筛，避免客户端把整表拉回去再 filter。
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

    const { archived } = getQuery(event);
    if (archived === 'active' || archived === 'false') {
        return db.select().from(projects).where(eq(projects.archived, false)).orderBy(asc(projects.createdAt));
    }
    if (archived === 'only' || archived === 'true') {
        return db.select().from(projects).where(eq(projects.archived, true)).orderBy(asc(projects.createdAt));
    }
    return db.select().from(projects).orderBy(asc(projects.createdAt));
});
