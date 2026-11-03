import { cancelOrphanApprovals } from '../agent/policy/approval';
import { recoverInterruptedToolCalls } from '../agent/session/recovery';
import { markInterruptedJobs } from '../utils/jobs';
import { markInterruptedSessionRuns } from '../utils/session-runs';

/**
 * 启动清理：上一次进程崩溃/重启留下的 `session_runs.status='running'` 不可能还在跑，
 * 标成 `interrupted` 后侧栏就不会再把它们显示成「生成中」。
 *
 * 同时补工具结果：崩溃时可能已经写了 `tool/call`、还没写 `tool/result`，
 * 不能让它悬空，也不能自动重跑（写操作可能已有副作用）——只标 `TOOL_OUTCOME_UNKNOWN`。
 *
 * 必须 await：数据库可能比应用晚就绪，但清理函数内部已 catch；先清理完再开始接请求，
 * 否则启动瞬间新插入的 running 可能被当成上次的残行标成 interrupted。
 */
export default defineNitroPlugin(async () => {
    const interrupted = await markInterruptedSessionRuns();
    await cancelOrphanApprovals();
    await markInterruptedJobs();
    await recoverInterruptedToolCalls(interrupted.map((run) => run.conversationId));
});
