/**
 * 定时任务到点执行。任务名由文件路径决定：`server/tasks/schedules/run-due.ts` → `schedules:run-due`。
 *
 * 调度写成「每分钟」而不是按排期各自的时刻：croner 用**进程本地时区**解释表达式，容器几乎全是 UTC，
 * 所以在 cron 里钉「0 9 * * *」会变成北京时间 17:00 才跑。这里让表达式只管唤醒频率，
 * 「北京时间 09:00」这条口径完全落在 `work-schedule.ts` 的 `nextRunAt` 计算里；
 * 空转的一分钟不产生任何外呼（没有到期的行就直接返回）。
 *
 * 唤醒频率决定的是排期的**落地精度**：一条排 09:00 的任务会在 09:00 那一次唤醒（最多晚几十秒）起跑，
 * 而不是恰好 09:00:000。本机工作台用不到秒级，写清楚免得有人以为可以改成每 5 分钟。
 *
 * `defineTask` 属 Nitro 自动导入，任务文件只由 Nitro 运行时加载，不在 tsx 直跑路径上。
 */
import { runDueSchedules } from '../../utils/schedule-runner';

export default defineTask({
    meta: {
        name: '定时任务执行',
        description: '认领并执行到点的定时任务（每轮最多 3 条，结果落成会话）',
    },
    async run() {
        try {
            const result = await runDueSchedules();
            return { result };
        } catch (error) {
            // 必须在这里吃掉：`server/plugins/error-guard.ts` 把未处理 rejection 变成 process.exit(1)，
            // 一次数据库抖动不该带走整个工作台（下一分钟的唤醒会自己补上没跑的那几条）。
            console.error('[tasks] 定时任务执行失败:', error);
            return { result: { ran: 0, ok: 0, failed: 0, error: (error as Error).message ?? String(error) } };
        }
    },
});
