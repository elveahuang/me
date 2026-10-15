import { desc, eq, sql } from 'drizzle-orm';
import { briefs } from '../db/schema';
import { briefDateInput, generateBrief } from '../utils/brief';
import { db } from '../utils/db';
import { gateExpensiveCalls } from '../utils/expensive-gate';
import { requireMethod } from '../utils/method';
import { intParam, stringParam } from '../utils/query';
import { capBody, readCappedJsonBody } from '../utils/request-body';
import { shanghaiDateKey } from '../utils/work-day';

/** 简报列表一次最多返回多少天：正文每篇可到 6000 字，无界列表会让一次刷新搬回几 MB。 */
const BRIEF_LIST_MAX = 60;

/**
 * 每日简报：读历史、按需生成。
 *
 * 生成走 `generateBrief()`，与定时任务 `server/tasks/brief/daily.ts` 共用同一条链路
 * （同一份快照采集与同一个 upsert 幂等口径），不在这里另写一遍提示词。
 */
export default defineEventHandler(async (event) => {
    await capBody(event);
    const method = requireMethod(event, ['GET', 'POST']);
    const query = getQuery(event);

    if (method === 'POST') {
        // 一次点击就是一次真实外呼，且没有循环保护：脚本或连点会把它打成常驻请求
        await gateExpensiveCalls('brief:generate', '生成简报', 5);
        const body = await readCappedJsonBody<Record<string, unknown>>(event);
        const rawDate = stringParam(body?.date, 10);
        const at = rawDate ? briefDateInput(rawDate) : null;
        if (rawDate && !at) throw createError({ statusCode: 400, statusMessage: 'date 必须是 YYYY-MM-DD' });
        try {
            return await generateBrief({ at: at ?? new Date(), force: body?.force === true });
        } catch (error) {
            // `resolveModel()` 抛的 400（没配供应商/没配 Key）要原样带状态码出去，
            // 其它（外呼超时、供应商 5xx）折成 502 的可读文案，不把上游原文透给界面
            if ((error as { statusCode?: number }).statusCode === 400) throw error;
            console.error('[briefs] 生成失败:', error);
            throw createError({ statusCode: 502, statusMessage: '生成简报失败，请检查模型供应商配置后重试' });
        }
    }

    const dateParam = stringParam(query.date, 10);
    if (dateParam) {
        const at = briefDateInput(dateParam);
        if (!at) throw createError({ statusCode: 400, statusMessage: 'date 必须是 YYYY-MM-DD' });
        const key = shanghaiDateKey(at);
        const [row] = await db.select().from(briefs).where(eq(briefs.briefDate, key));
        return { date: key, brief: row ?? null };
    }

    const limit = intParam(query.limit, 14, 1, BRIEF_LIST_MAX);
    // 列表默认不带正文：一篇可到 6000 字，14 篇一起搬回浏览器会让每次刷新变成上百 KB。
    // `?full=1` 才给全文（简报历史页展开某天时按需再取单日）。
    if (stringParam(query.full) === '1') {
        return db.select().from(briefs).orderBy(desc(briefs.briefDate)).limit(limit);
    }
    return db
        .select({ briefDate: briefs.briefDate, model: briefs.model, generatedAt: briefs.generatedAt, excerpt: sql<string>`left(${briefs.content}, 160)` })
        .from(briefs)
        .orderBy(desc(briefs.briefDate))
        .limit(limit);
});
