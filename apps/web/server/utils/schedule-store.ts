import { eq } from 'drizzle-orm';
import { createError } from 'h3';
import { agents, type Schedule } from '../db/schema';
import { db } from './db';
import { normalizeWorkId } from './work-input';
import { computeNextRunAt, normalizeSchedulePlan, type SchedulePlan } from './work-schedule';

/**
 * 定时任务的共享数据访问：写入前的引用校验与「按当前配置算下一次时刻」。
 *
 * 与 `work-schedule.ts` 分开放是因为这里要连库，而那边的归一与时刻计算保持纯函数，
 * 冒烟测试才能直接断言跨月/闰年/星期选择这些等一分钟才看得出问题的形状。
 */

/** 与 `db.transaction` 回调拿到的句柄兼容的最小集合（同 `ref-lock.ts` 的 LockRunner）。 */
type DbRunner = Pick<typeof db, 'select'>;

/**
 * 定时任务指向的智能体必须存在且启用。
 *
 * `runner` 传事务句柄时那次读带 `FOR SHARE`：`schedules.agent_id` 是 `onDelete: cascade`，
 * 「事务外先查存在 → 再插/改」之间若智能体被另一条连接删掉，这条排期会在插入的同一刻被级联带走，
 * 界面拿到 200 却永远看不到它；改 agentId 的那次 UPDATE 则直接撞 23503，把整张列清单透出响应体。
 * 与 `settings/agents/[id].ts` DELETE 侧的 `FOR UPDATE` 配对，锁的两侧才算都关上门。
 */
export async function assertScheduleAgent(raw: unknown, runner: DbRunner = db): Promise<string> {
    // 形状先夹住：work 的 id 全部来自 crypto.randomUUID()，非 uuid 的输入不可能命中，
    // 让它进 `eq()` 只是白白多打一次库（且带 NUL 的串会被 PostgreSQL 拒成 22021 → 500 透出列清单）
    const id = normalizeWorkId(raw, 'agentId');
    const [row] = await runner.select({ id: agents.id, enabled: agents.enabled }).from(agents).where(eq(agents.id, id)).for('share');
    if (!row) throw createError({ statusCode: 400, statusMessage: 'agentId 指向的智能体不存在' });
    // 停用的智能体不能挂定时任务：runner 到点只会拿到「模型不可用」，
    // 用户看到的却是一个「设置了却永远不跑」的任务——在写入时拒绝比到点静默跳过更好读。
    if (!row.enabled) throw createError({ statusCode: 400, statusMessage: 'agentId 指向的智能体已停用，请先启用它' });
    return id;
}

export function planOf(row: Pick<Schedule, 'kind' | 'timeText' | 'intervalMinutes' | 'days' | 'startsAt'>): SchedulePlan {
    return { kind: row.kind, timeText: row.timeText, intervalMinutes: row.intervalMinutes, days: row.days, startsAt: row.startsAt };
}

/**
 * 表单值 → 落库形状：归一后的 plan 与算出的下一次时刻。
 *
 * API 与 runner 都读这一份，避免「界面显示的时间」与「真正拿去算下一次时刻的字段」来自两套解析。
 *
 * 时刻为 null 意味着这条配置永远不会再触发（`once` 的时间已经过了，或 `weekly` 的星期怎么选都对不上），
 * 直接 400 而不是存一个过去的 `nextRunAt`：后者会让 runner 在下一分钟把它捡起来跑一次，
 * 用户以为保存的是「明天 09:00」，实际收到的是「刚刚跑了一轮」。
 */
export function resolveSchedulePlan(
    input: { kind: unknown; time: unknown; intervalMinutes: unknown; days: unknown; startsAt: Date },
    after: Date,
): { plan: SchedulePlan; nextRunAt: Date } {
    const plan = normalizeSchedulePlan(input);
    const nextRunAt = computeNextRunAt(plan, after);
    if (!nextRunAt) throw createError({ statusCode: 400, statusMessage: '按当前配置算不出未来的执行时间，请检查开始时间是否已经过去' });
    return { plan, nextRunAt };
}

/** PATCH 用：合并后的行必须与新建走同一套校验，否则「先建 daily 再改成 weekly 不选星期」能绕过闸门。 */
export function resolvePlanOfRow(
    row: Schedule,
    patch: { kind?: unknown; time?: unknown; intervalMinutes?: unknown; days?: unknown; startsAt?: Date },
    after: Date,
) {
    return resolveSchedulePlan(
        {
            kind: patch.kind ?? row.kind,
            time: patch.time === undefined ? row.timeText : patch.time,
            intervalMinutes: patch.intervalMinutes === undefined ? row.intervalMinutes : patch.intervalMinutes,
            days: patch.days === undefined ? row.days : patch.days,
            startsAt: patch.startsAt ?? row.startsAt,
        },
        after,
    );
}
