import { and, eq } from 'drizzle-orm';
import { schedules } from '../../../db/schema';
import { db } from '../../../utils/db';
import { gateExpensiveCalls } from '../../../utils/expensive-gate';
import { requireMethod } from '../../../utils/method';
import { capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';
import { notRunningNow, runScheduleNow, runningStaleBefore } from '../../../utils/schedule-runner';

/**
 * 手动跑一轮：`POST /api/schedules/{id}/run`。
 *
 * 立刻返回而不是等模型跑完：一轮生成最长 `RUN_TOTAL_BUDGET_MS`（5 分钟），
 * 把它做成一次同步 HTTP 请求等于让浏览器转圈五分钟，还容易被反向代理掐断在中间；
 * 而这条链路的真相本来就落在库里（`lastStatus` / 那条会话），界面按列表刷新就能看到结果。
 * 「正在跑」由行上的 `lastStatus='running'` 表示，所以重复点击会被下面的 409 挡住，
 * 不会出现同一排期并排跑两轮、写出两条会话。
 */
export default defineEventHandler(async (event) => {
    await capBody(event);
    requireMethod(event, ['POST']);
    const id = routeId(event, 'id', '定时任务');

    // 一次点击就是一次真实外呼，按行建键：点 A 条不影响 B 条，正常手动验证留足余量
    await gateExpensiveCalls(`schedule-run:${id}`, '手动运行', 5);

    // 认领必须是「改状态」而不是「读状态」：两个标签页同时点，先读后判会双双通过，
    // 于是同一排期并排跑两轮、写出两条会话。这条带条件的 UPDATE 在行上串行，
    // 后到的那个拿到 0 行，因此得到的是 409 而不是第二次外呼。
    // 闸门与 runner 的认领共用 `notRunningNow`：卡在 `running` 超过一轮预算的行不该让人一直点不动。
    const [claimed] = await db
        .update(schedules)
        .set({ lastStatus: 'running', lastRunAt: new Date(), lastError: '' })
        .where(and(eq(schedules.id, id), notRunningNow(runningStaleBefore())))
        .returning();
    if (!claimed) {
        const exists = await db.select({ id: schedules.id }).from(schedules).where(eq(schedules.id, id));
        if (!exists.length) throw createError({ statusCode: 404, statusMessage: '定时任务不存在' });
        throw createError({ statusCode: 409, statusMessage: '这一条正在执行，请等它跑完' });
    }

    // 写回也在 runner 里做完；这里必须自带 catch，
    // 否则 rejection 逃逸到 `error-guard` 会变成整个进程退出（用户点一下「立即运行」把工作台弄挂）。
    void runScheduleNow(claimed).catch((error) => console.error('[schedules] 手动运行失败:', error));

    return { started: true };
});
