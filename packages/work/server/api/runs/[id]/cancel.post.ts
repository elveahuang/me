import { eq } from 'drizzle-orm';
import { automationRuns } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireMethod } from '../../../utils/method';
import { rateLimit } from '../../../utils/rate-limit';
import { capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';
import { cancelScheduleRun } from '../../../utils/schedule-runner';

/**
 * 取消一轮正在执行的定时任务。
 *
 * 只对「本进程正在跑」的运行有效：`automation_runs.status='running'` 也可能是上一进程遗留的行，
 * 启动自愈会把它收口成失败，这里不能仅凭库里的状态就宣称取消成功。
 */
export default defineEventHandler(async (event) => {
    await capBody(event);
    requireMethod(event, ['POST']);
    const id = routeId(event, 'id', '运行记录');
    const limited = await rateLimit(`run-cancel:${id}`, 10, 60_000);
    if (!limited.ok) throw createError({ statusCode: 429, statusMessage: `操作过于频繁，请 ${limited.retryAfterSec} 秒后再试` });

    const [run] = await db.select({ id: automationRuns.id, status: automationRuns.status }).from(automationRuns).where(eq(automationRuns.id, id));
    if (!run) throw createError({ statusCode: 404, statusMessage: '运行记录不存在' });
    if (run.status !== 'running') throw createError({ statusCode: 409, statusMessage: '这一轮已经结束，无需取消' });

    if (!cancelScheduleRun(id)) {
        throw createError({
            statusCode: 409,
            statusMessage: '这一轮不在当前进程执行（可能进程已重启），已无法中断，请等待自动收口',
        });
    }
    return { cancelled: true };
});
