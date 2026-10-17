/**
 * 每日简报生成。任务名由文件路径决定：`server/tasks/brief/daily.ts` → `brief:daily`。
 *
 * 调度刻意写成「每小时第 7 分钟」而不是「每天 07:30」：
 * node preset 的调度器用 croner 的**进程本地时区**解释 cron 表达式，而容器几乎全是 UTC，
 * 钉死 07:30 会让北京时间的简报在下午 15:30 才生成——用户早上打开工作台时永远是空的。
 * 每小时唤醒一次、由 `ensureTodayBrief()` 自己判断「北京时间的今天还没有简报」才生成，
 * 时区口径就与 `/api/overview`、`/api/briefs` 一样收敛在 `work-day.ts` 里；
 * 每天真正外呼只有一次（当天已有简报时直接返回）。
 *
 * 多实例部署下每个实例都会注册这份调度，但落库是按日期主键的 upsert，
 * 两个实例同时补生成也只是后一次覆盖同一天。
 *
 * `defineTask` 属 Nitro 自动导入（与 webapp 的 `server/tasks/orders/close-stale.ts` 同一写法）：
 * 任务文件只由 Nitro 运行时加载，不在 tsx 直跑路径上，因此不需要显式 import。
 */
import { ensureTodayBrief } from '../../utils/brief';

export default defineTask({
    meta: {
        name: '每日简报',
        description: '为北京时间今天生成工作台简报（当天已存在则跳过，不重复调用模型）',
    },
    async run() {
        // 北京时间 05:00 之前不生成：那几小时「今天」的事实几乎全是昨天的残影，
        // 生成了反而会把今天的简报钉死在一份没有内容的快照上（当天不再重跑）。
        const hourBeijing = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours();
        if (hourBeijing < 5) return { result: { ran: false, reason: '北京时间尚清晨，等待 05:00 后的整点' } };

        try {
            const ran = await ensureTodayBrief();
            return { result: ran };
        } catch (error) {
            // 定时任务失败不能让进程退出（error-guard 会把未处理 rejection 变成 process.exit），
            // 这里吃掉并回传原因，下一小时的整点会再试一次
            console.error('[tasks] 每日简报生成失败:', error);
            return { result: { ran: false, reason: (error as Error).message ?? String(error) } };
        }
    },
});
