import { desc, ilike, or, sql } from 'drizzle-orm';
import { events, notes, projects, tasks } from '../db/schema';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { intParam, likePattern, stringParam } from '../utils/query';
import { capBody } from '../utils/request-body';

const PER_GROUP_MAX = 50;

/**
 * 全局检索：一次查遍任务 / 笔记 / 日程 / 项目。
 *
 * 结果按实体分组返回而不是混排打分：本机数据量小到不需要相关性排序，
 * 混排反而要求前端再拆一次；分组还能让「某一类没命中」显示成空分组而不是整块缺失。
 *
 * 笔记正文可达数百 KB，命中片段用 position/substring 在库里截窗口，
 * 整篇搬进响应会让一次搜索键入变成几 MB 传输。
 */
export default defineEventHandler(async (event) => {
    await capBody(event);
    requireMethod(event, ['GET']);
    const keyword = stringParam(getQuery(event).q, 128) ?? '';
    if (!keyword) return { q: '', tasks: [], notes: [], events: [], projects: [] };

    const pattern = likePattern(keyword);
    const limit = intParam(getQuery(event).limit, 10, 1, PER_GROUP_MAX);

    const [taskHits, noteHits, eventHits, projectHits] = await Promise.all([
        db
            .select({
                id: tasks.id,
                title: tasks.title,
                status: tasks.status,
                priority: tasks.priority,
                dueAt: tasks.dueAt,
                projectId: tasks.projectId,
            })
            .from(tasks)
            .where(or(ilike(tasks.title, pattern), ilike(tasks.detail, pattern)))
            .orderBy(desc(tasks.updatedAt))
            .limit(limit),
        db
            .select({
                id: notes.id,
                title: notes.title,
                kind: notes.kind,
                updatedAt: notes.updatedAt,
                snippet: sql<string>`case
                    when position(lower(${keyword}) in lower(${notes.content})) > 0
                    then substring(${notes.content} from greatest(position(lower(${keyword}) in lower(${notes.content})) - 60, 1) for 200)
                    else left(${notes.content}, 200) end`,
            })
            .from(notes)
            .where(or(ilike(notes.title, pattern), ilike(notes.content, pattern)))
            .orderBy(desc(notes.updatedAt))
            .limit(limit),
        db
            .select({ id: events.id, title: events.title, startsAt: events.startsAt, allDay: events.allDay, projectId: events.projectId })
            .from(events)
            .where(or(ilike(events.title, pattern), ilike(events.detail, pattern), ilike(events.location, pattern)))
            .orderBy(desc(events.startsAt))
            .limit(limit),
        db
            .select({ id: projects.id, name: projects.name, color: projects.color, archived: projects.archived })
            .from(projects)
            .where(or(ilike(projects.name, pattern), ilike(projects.description, pattern)))
            .orderBy(projects.name)
            .limit(limit),
    ]);

    return { q: keyword, tasks: taskHits, notes: noteHits, events: eventHits, projects: projectHits };
});
