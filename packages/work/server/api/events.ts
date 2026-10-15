import { and, asc, desc, eq, gte, ilike, lt, type SQL } from 'drizzle-orm';
import { events } from '../db/schema';
import { normalizeAdminBoolean } from '../utils/admin-boolean';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { LOCAL_OWNER } from '../utils/owner';
import { intParam, likePattern, stringParam } from '../utils/query';
import { rateLimit } from '../utils/rate-limit';
import { capBody } from '../utils/request-body';
import { shanghaiDateInput, shanghaiDayRange } from '../utils/work-day';
import {
    EVENT_LOCATION_MAX,
    WORK_DETAIL_MAX,
    WORK_TITLE_MAX,
    normalizeWorkDate,
    normalizeWorkDateRange,
    normalizeWorkOptionalText,
    normalizeWorkSource,
    normalizeWorkText,
} from '../utils/work-input';
import { assertProjectExists, lockProjectRow } from '../utils/work-project';

/** 日程一次拉取的上下限：月视图够用，也挡住用 ?from=0 拉全表。 */
const EVENT_LIST_MAX = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export default defineEventHandler(async (event) => {
    await capBody(event);
    const method = requireMethod(event, ['GET', 'POST']);
    const query = getQuery(event);

    if (method === 'POST') {
        const limited = await rateLimit(`event-create:${LOCAL_OWNER}`, 60, 60_000);
        if (!limited.ok) throw createError({ statusCode: 429, statusMessage: `创建过于频繁，请 ${limited.retryAfterSec} 秒后再试` });

        const body = (await readBody(event)) ?? {};
        const startsAt = normalizeWorkDate(body.startsAt, 'startsAt');
        if (!startsAt) throw createError({ statusCode: 400, statusMessage: 'startsAt 必填' });
        const id = crypto.randomUUID();
        const projectId = await assertProjectExists(body.projectId);
        await db.transaction(async (tx) => {
            await lockProjectRow(tx, projectId);
            await tx.insert(events).values({
                id,
                projectId,
                title: normalizeWorkText(body.title, 'title', WORK_TITLE_MAX),
                detail: normalizeWorkOptionalText(body.detail, 'detail', WORK_DETAIL_MAX),
                startsAt,
                endsAt: normalizeWorkDateRange(body.endsAt, startsAt),
                allDay: normalizeAdminBoolean(body.allDay, 'allDay', false),
                location: normalizeWorkOptionalText(body.location, 'location', EVENT_LOCATION_MAX),
                reminderAt: normalizeWorkDate(body.reminderAt, 'reminderAt'),
                source: normalizeWorkSource(body.source),
            });
        });
        const [row] = await db.select().from(events).where(eq(events.id, id));
        return row;
    }

    const where: SQL[] = [];
    // 不给区间时默认「今天起 90 天」：日历首屏要的是接下来的安排，
    // 无界查询会把历史日程全拉回来（列表按 startsAt 排序，过去的排在最前，界面看到的是旧数据）。
    // 「今天」必须按北京日取：new Date().toISOString().slice(0,10) 拿的是 UTC 日期，
    // 北京时间 00:00–08:00（UTC 16:00–24:00）那 8 小时里它会说「今天」是昨天，
    // 于是日历首屏混进已结束的一天，也与 Today 页/简报用的 shanghaiDayRange 口径不一致。
    const today = shanghaiDayRange(new Date()).start;
    const from = stringParam(query.includePast) === '1' ? null : (shanghaiDateInput(query.from, 'start') ?? today);
    const to = shanghaiDateInput(query.to, 'end') ?? new Date((from ?? today).getTime() + 90 * DAY_MS);
    if (from) where.push(gte(events.startsAt, from));
    where.push(lt(events.startsAt, new Date(to.getTime() + 1)));

    const projectId = stringParam(query.projectId);
    if (projectId) where.push(eq(events.projectId, projectId));

    const keyword = stringParam(query.keyword);
    if (keyword) where.push(ilike(events.title, likePattern(keyword)));

    const limit = intParam(query.limit, EVENT_LIST_MAX, 1, EVENT_LIST_MAX);
    const order = stringParam(query.order) === 'updated' ? [desc(events.updatedAt)] : [asc(events.startsAt)];
    return db
        .select()
        .from(events)
        .where(and(...where))
        .orderBy(...order)
        .limit(limit);
});
