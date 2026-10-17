import { generateText, stepCountIs } from 'ai';
import { and, asc, eq, inArray, isNull, lt, lte, ne, or } from 'drizzle-orm';
import {
    agentKnowledgeBases,
    agentMcpServers,
    agentSkills,
    agentTools,
    agents,
    automationRuns,
    conversations,
    knowledgeBases,
    messages,
    schedules,
    skills,
    spaces,
    tools as toolsTable,
    type Schedule,
} from '../db/schema';
import { db } from './db';
import { retrieveContext } from './embedding';
import { LOCAL_TOOL_SUMMARY, buildLocalFileTools } from './local-tools';
import { closeMcpConnections, connectEnabledMcpServers, mergeMcpTools } from './mcp';
import { resolveModel } from './providers';
import { lockAgentRow } from './ref-lock';
import { planOf } from './schedule-store';
import { buildSystemPrompt } from './system-prompt';
import { buildToolSet } from './tools';
import { shanghaiDateKey } from './work-day';
import { computeNextRunAt } from './work-schedule';
import { WORKBENCH_TOOL_SUMMARY, buildWorkbenchTools } from './workbench-tools';

/**
 * 定时任务的执行侧：到点自动跑一轮智能体，把结果落成一条会话。
 *
 * 为什么不复用 `/api/chat`：那条链路是为「浏览器正在看这一次生成」服务的——SSE 流、
 * 客户端 parts 白名单、附件引用校验、`chat-runs` 回放缓冲、按会话的停止接口。
 * 后台那一轮没有任何接收方，需要的只是「同样的系统提示词 + 同样的工具 + 把答案写进库」，
 * 所以这里走 `generateText`（非流式、带工具、带同一组超时预算），落库形状与聊天完全一致，
 * 用户回到工作台点开那条会话就能接着往下问。
 */

/** 一轮排队的执行预算：外层总闸，配合下面三个分步预算，避免失控的工具循环把 runner 钉死。 */
const RUN_TOTAL_BUDGET_MS = 5 * 60_000;
/** 与 `/api/chat` 同一口径的分步预算（工具 / 首个内容块 / 相邻内容块），取值理由见 chat.ts。 */
const TOOL_TIMEOUT_MS = 30_000;
const FIRST_CHUNK_TIMEOUT_MS = 60_000;
const CHUNK_TIMEOUT_MS = 60_000;
/** 每分钟最多认领几条：一次认领就是一次真实外呼，积压时宁可排队也不要同时打满供应商。 */
const RUNS_PER_TICK = 3;
/** 落库正文上限：超出说明模型在复读，截断比塞满 jsonb 好。 */
const RESULT_TEXT_MAX = 200_000;
/**
 * `running` 还算「真的在跑」的时间窗：一轮最长 `RUN_TOTAL_BUDGET_MS`，再加两分钟的落库与关连接余量。
 *
 * 超过这个窗还没收尾的行只有一种解释——进程在那中间被打断了（dev 热重载、崩溃、容器重启）。
 * 它既是认领侧的豁免线（否则一条卡住的排期永远不再被跑），也是自愈的判定线。
 */
const RUNNING_STALE_MS = RUN_TOTAL_BUDGET_MS + 2 * 60_000;

/**
 * 单进程内的「这一轮还在跑」闸门。
 *
 * croner 不保证上一轮没结束时不启动下一轮，而这里的认领是 `SKIP LOCKED`——
 * 数据库层面不会重复跑同一条任务，但两次唤醒可以各自跑不同的任务，
 * 于是积压 + 慢供应商会让十几个模型调用同时在外呼。本机应用一次只跑一批，
 * 下一分钟的唤醒自然会接上剩下的。
 */
let tickInFlight = false;

export type ScheduleRunResult = { ok: boolean; conversationId?: string; error?: string; runId?: string };

/**
 * 自己造的、可以原样展示给用户的失败。
 *
 * 只有这个类的实例允许把 `.message` 写进 `lastError`；其余异常一律折成类别（见 `describeRunError`）。
 */
export class RunFailure extends Error {}

/**
 * 把一轮执行的异常收成「能进界面、也能进模型上下文」的一句话，细节只进服务端日志。
 *
 * 为什么不能直接把 `error.message` 存进 `lastError`：这个字段有两条出口——
 * `/api/schedules` 把它原样渲染在 `/tasks` 列表里，`work_today` 工具又把它拼进工具结果发给外部模型供应商。
 * 而这一轮跑在 drizzle、AI SDK 与 MCP 建连之上，drizzle 的 `QueryError.message` 是
 * `Failed query: insert into "messages" (…) <绑定参数>`：里面既有整张列清单，也有这条排期的 prompt 正文
 * 和那句没能落库的回复。供应商错误文本同理（含模型名、上游地址、重试状态）。
 * 分类不给细节不是偷懒：本机没有工单系统，日志就在同一台机器的终端里，运维看 `console.error`，
 * 用户只需要知道「这一轮为什么没跑出来」是哪一类。
 */
export function describeRunError(error: unknown): string {
    if (error instanceof RunFailure) return error.message;

    const record = (error ?? {}) as Record<string, unknown>;
    const message = typeof record.message === 'string' ? record.message : String(error);
    // h3 的 createError 同时带 statusCode 与 statusMessage，那是我们自己写的可读结论（「智能体不存在」），
    // 直接展示；缺这对字段的一律来自第三方，只能归类，不能转述。
    if (typeof record.statusCode === 'number' && typeof record.statusMessage === 'string' && record.statusMessage) {
        console.error('[schedules] 执行被拒:', record.statusMessage);
        return record.statusMessage;
    }
    console.error('[schedules] 执行异常:', error);
    // drizzle 把 SQL 挂在自有字段上，AI SDK 的调用错误带 statusCode；两者都不在 message 之外再暴露内容
    if (typeof record.query === 'string' || message.includes('Failed query:') || record.name === 'QueryFailedError') return '数据库写入失败';
    if (record.name === 'AbortError' || record.name === 'TimeoutError' || /timeout|abort|中断/i.test(message)) return '执行超时或被中断';
    if (typeof record.statusCode === 'number' || typeof record.status === 'number') return '模型或工具调用失败（上游返回了错误状态）';
    return '模型或工具调用失败';
}

type McpConnections = Awaited<ReturnType<typeof connectEnabledMcpServers>>;

/**
 * 「这一条此刻没在跑」的判定。
 *
 * 认领与手动运行共用它，两侧口径必须一致，否则会出现「界面说在跑、runner 又跑了一轮」。
 * 三个分支缺一不可：
 * - `lastStatus <> 'running'`：正常情况。
 * - `lastRunAt is null`：`running` 却没有时刻的脏行（手改库），不加这条它既不满足时间窗、又因 running 被永久排除。
 * - `lastRunAt < staleBefore`：超预算的卡死行——先由 `reclaimStaleRunning` 标成失败，即便自愈那步没跑成也不能把排期永远锁死。
 */
export function notRunningNow(staleBefore: Date) {
    return or(ne(schedules.lastStatus, 'running'), isNull(schedules.lastRunAt), lt(schedules.lastRunAt, staleBefore));
}

/** 手动运行与认领共用的「在跑」豁免线：超过它就当作没有结论。 */
export function runningStaleBefore(now: Date = new Date()): Date {
    return new Date(now.getTime() - RUNNING_STALE_MS);
}

/**
 * 把上一轮没留下结论的行收口成失败。
 *
 * 为什么必须自愈而不是任它停着：`running` 在 `/tasks` 的清单里既不算「今天已跑」，也挡得住手动运行（409），
 * 用户看到的现象是「这条任务从今天起再也没跑过、点立即运行一直报错」，且库里没有任何一行说明原因。
 * 收口成带原因的失败之后，它同时出现在清单、失败计数与那次运行的会话里。
 */
async function reclaimStaleRunning(now: Date): Promise<number> {
    const reclaimed = await db
        .update(schedules)
        .set({
            lastStatus: 'failed',
            lastError: '上一轮执行没有留下结论（工作台可能在它跑完前被打断），已按失败收口',
            updatedAt: now,
        })
        .where(and(eq(schedules.lastStatus, 'running'), lt(schedules.lastRunAt, runningStaleBefore(now))))
        .returning({ id: schedules.id });
    await db
        .update(automationRuns)
        .set({ status: 'failed', finishedAt: now, error: '执行进程在收尾前退出，已按失败收口' })
        .where(and(eq(automationRuns.status, 'running'), lt(automationRuns.startedAt, runningStaleBefore(now))));
    if (reclaimed.length) console.warn(`[schedules] ${reclaimed.length} 条排期的上一轮没有收尾，已按失败收口`);
    return reclaimed.length;
}

/**
 * 认领到期的行并把它们推进到下一次（或停用 `once`）。
 *
 * `FOR UPDATE SKIP LOCKED`：work 只有一个进程，但 dev 热重载与生产实例会重叠几秒，
 * 那时两个 runner 都不该跑同一条——被锁住的那条直接跳过给另一个，不排队等待，
 * 否则一次慢认领会把整个每分钟的唤醒钉在行锁上。
 */
async function claimDue(now: Date): Promise<Schedule[]> {
    return db.transaction(async (tx) => {
        const due = await tx
            .select()
            .from(schedules)
            .where(and(eq(schedules.enabled, true), lte(schedules.nextRunAt, now), notRunningNow(runningStaleBefore(now))))
            .orderBy(asc(schedules.nextRunAt))
            .limit(RUNS_PER_TICK)
            .for('update', { skipLocked: true });

        const claimed: Schedule[] = [];
        for (const row of due) {
            // 先推进 nextRunAt 再跑：这一轮失败也不能让下一分钟重新认领同一条，
            // 否则一个持续失败的排期会变成每分钟的固定外呼。
            const next = computeNextRunAt(planOf(row), now);
            const enabled = next !== null;
            await tx
                .update(schedules)
                .set({ lastRunAt: now, lastStatus: 'running', lastError: '', nextRunAt: next ?? row.nextRunAt, enabled, updatedAt: now })
                .where(eq(schedules.id, row.id));
            claimed.push({ ...row, nextRunAt: next ?? row.nextRunAt, enabled });
        }
        return claimed;
    });
}

/** 把一轮生成写进库并回结论；任何一步失败都只影响这一条排期，绝不把异常抛给调用方。 */
async function executeSchedule(row: Schedule, at: Date, trigger: 'schedule' | 'manual' | 'retry' = 'schedule'): Promise<ScheduleRunResult> {
    // 连接句柄开在 try 之外：`connectEnabledMcpServers` 之后任何一步抛错，`finally` 都要关得到它已建立的连接
    let mcpConnections: McpConnections = [];
    let conversationId: string | null = null;
    const runId = crypto.randomUUID();
    try {
        await db.insert(automationRuns).values({
            id: runId,
            scheduleId: row.id,
            status: 'running',
            trigger,
            scheduledFor: trigger === 'schedule' ? at : null,
            startedAt: new Date(),
            prompt: row.prompt,
        });
        const [agent] = await db.select().from(agents).where(eq(agents.id, row.agentId));
        if (!agent) return { ok: false, runId, error: '智能体已被删除' };
        if (!agent.enabled) return { ok: false, runId, error: '智能体已停用' };

        const [boundSkillRows, boundToolRows, boundKbIds, boundMcpIds] = await Promise.all([
            db
                .select({ skill: skills })
                .from(agentSkills)
                .innerJoin(skills, eq(skills.id, agentSkills.skillId))
                .where(and(eq(agentSkills.agentId, row.agentId), eq(skills.enabled, true))),
            db
                .select({ tool: toolsTable })
                .from(agentTools)
                .innerJoin(toolsTable, eq(toolsTable.id, agentTools.toolId))
                .where(and(eq(agentTools.agentId, row.agentId), eq(toolsTable.enabled, true))),
            db
                .select({ kbId: agentKnowledgeBases.kbId })
                .from(agentKnowledgeBases)
                .where(eq(agentKnowledgeBases.agentId, row.agentId))
                .then((rows) => rows.map((r) => r.kbId)),
            db
                .select({ mcpServerId: agentMcpServers.mcpServerId })
                .from(agentMcpServers)
                .where(eq(agentMcpServers.agentId, row.agentId))
                .then((rows) => rows.map((r) => r.mcpServerId)),
        ]);

        const spaceKbIds = boundKbIds.length
            ? (
                  await db
                      .select({ id: knowledgeBases.id })
                      .from(knowledgeBases)
                      .where(and(eq(knowledgeBases.spaceId, row.spaceId), inArray(knowledgeBases.id, boundKbIds)))
              ).map((item) => item.id)
            : [];

        let knowledgeContext: string | null = null;
        if (spaceKbIds.length && row.prompt.trim()) {
            try {
                const { context, hits } = await retrieveContext(spaceKbIds, row.prompt.trim());
                if (context && hits.length) knowledgeContext = context;
            } catch (error) {
                // 检索失败与聊天同口径：降级成「没有参考资料」继续跑，而不是把这一轮判成失败
                console.error('[schedules] RAG 检索异常:', error);
            }
        }

        const [space] = await db.select({ name: spaces.name, instructions: spaces.instructions }).from(spaces).where(eq(spaces.id, row.spaceId));
        const { model } = await resolveModel(agent.providerId, agent.model);

        const localTools = buildLocalFileTools();
        let toolSet = {
            ...buildWorkbenchTools(row.agentId, row.spaceId),
            ...localTools,
            ...buildToolSet(boundToolRows.map((r) => r.tool)),
        };
        const toolSummary = [
            WORKBENCH_TOOL_SUMMARY,
            ...(Object.keys(localTools).length ? [LOCAL_TOOL_SUMMARY] : []),
            ...boundToolRows.filter((r) => r.tool.enabled).map((r) => `- ${r.tool.name}：${r.tool.description}`),
        ].join('\n');
        mcpConnections = await connectEnabledMcpServers(boundMcpIds);
        if (mcpConnections.length) toolSet = mergeMcpTools(toolSet, mcpConnections);

        // 闭包里用局部 const：外层 `conversationId` 是 `string | null`（finally 里还要读它判断
        // 「这一轮有没有留下会话」），TS 不会把回调里的赋值算作收窄，直接插会报 id 可为 null。
        const conversationRowId = crypto.randomUUID();
        const title = `${row.title} · ${shanghaiDateKey(at)}`;
        // 会话与那句 prompt 仍在调用模型 **之前** 落库（失败的一轮也留得下现场），但两条 INSERT 必须同事务、
        // 并对父行取锁：`conversations.agent_id` 是 cascade，上面那次读到这里之间智能体可能已被删掉，
        // 裸插撞 23503 会让这一轮白烧一次外呼，还留下一条永远读不到归属的会话。
        // 与 POST /api/conversations、/api/chat 同一道闸门（见 utils/ref-lock）。
        await db.transaction(async (tx) => {
            await lockAgentRow(tx, row.agentId);
            await tx.insert(conversations).values({ id: conversationRowId, agentId: row.agentId, spaceId: row.spaceId, title });
            await tx.insert(messages).values({
                id: `cmsg_${crypto.randomUUID()}`,
                conversationId: conversationRowId,
                role: 'user',
                parts: [{ type: 'text', text: row.prompt }],
            });
        });
        // 事务提交之后才认这条会话：插入失败（智能体被并发删除、库断连）时它并不存在，
        // 提前赋值会让失败结论带着一个死 id 写进 lastConversationId——`/tasks` 那行的
        // 「打开运行结果」于是永远点进一条 404。
        conversationId = conversationRowId;

        const { text } = await generateText({
            model,
            system: buildSystemPrompt(
                agent,
                boundSkillRows.map((r) => r.skill),
                knowledgeContext,
                toolSummary,
                undefined,
                space,
            ),
            prompt: row.prompt,
            tools: toolSet,
            stopWhen: stepCountIs(agent.maxSteps),
            temperature: agent.temperature ?? undefined,
            maxOutputTokens: agent.maxTokens ?? undefined,
            timeout: { firstChunkMs: FIRST_CHUNK_TIMEOUT_MS, chunkMs: CHUNK_TIMEOUT_MS, toolMs: TOOL_TIMEOUT_MS },
            abortSignal: AbortSignal.timeout(RUN_TOTAL_BUDGET_MS),
        });
        const content = text.trim().slice(0, RESULT_TEXT_MAX);
        if (!content) throw new RunFailure('模型没有返回可用正文');
        await db.insert(messages).values({ id: `cmsg_${crypto.randomUUID()}`, conversationId, role: 'assistant', parts: [{ type: 'text', text: content }] });
        await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
        return { ok: true, conversationId, runId };
    } catch (error) {
        // 这一条 catch 是整个执行侧的收尾保证：`resolveModel`、MCP 建连、两条 insert 都在外呼之前，
        // 以前它们抛错会把异常一路抛进 runner，那一行就永久停在 `running`——
        // `/tasks` 的清单查不到它、手动运行永远 409、下一分钟也不会再认领，而且界面上一句原因都没有。
        // 原因本身走 describeRunError：这个字段会被列表渲染、也会被 work_today 发给外部供应商，
        // 原始 message 里装着 drizzle 的整条 SQL 与绑定参数（也就是这条排期的 prompt 正文）。
        const id = conversationId;
        return { ok: false, runId, ...(id ? { conversationId: id } : {}), error: describeRunError(error) };
    } finally {
        // 连接必须在任何分支下关掉：定时任务没有「请求结束」这个时刻，漏掉的 MCP 子进程会一直挂在进程里
        await closeMcpConnections(mcpConnections).catch((error) => console.error('[schedules] 关闭 MCP 连接失败:', error));
    }
}

/** 写回这一轮的结论。`running` 只在认领与落库之间那段时间存在，任何分支都必须被它收尾。 */
async function finishSchedule(row: Schedule, at: Date, result: ScheduleRunResult): Promise<void> {
    const finishedAt = new Date();
    await db
        .update(schedules)
        .set({
            lastStatus: result.ok ? 'success' : 'failed',
            lastError: result.ok ? '' : (result.error ?? '未知错误').slice(0, 500),
            lastConversationId: result.conversationId ?? null,
            updatedAt: finishedAt,
        })
        .where(and(eq(schedules.id, row.id), eq(schedules.lastRunAt, at)));
    if (result.runId) {
        await db
            .update(automationRuns)
            .set({
                status: result.ok ? 'success' : 'failed',
                finishedAt,
                durationMs: Math.max(0, finishedAt.getTime() - at.getTime()),
                outputConversationId: result.conversationId ?? null,
                error: result.ok ? '' : (result.error ?? '未知错误').slice(0, 500),
            })
            .where(eq(automationRuns.id, result.runId));
    }
}

/**
 * 每分钟唤醒一次的入口。
 *
 * 返回值写进 Nitro 的任务日志，运维看得到「这一轮认领了几条、几条失败、有没有卡死的行被收口」，
 * 而不是「什么都没发生」——排期没跑最容易读成「功能坏了」，日志是唯一的解释口。
 */
export async function runDueSchedules(now: Date = new Date()): Promise<{ ran: number; ok: number; failed: number; reclaimed?: number; skipped?: string }> {
    if (tickInFlight) return { ran: 0, ok: 0, failed: 0, skipped: '上一轮仍在执行' };
    tickInFlight = true;
    try {
        // 先自愈再认领：上一轮没收尾的行会占着 `running`，不收口就永远排不进这一轮
        const reclaimed = await reclaimStaleRunning(now);
        const claimed = await claimDue(now);
        let ok = 0;
        let failed = 0;
        for (const row of claimed) {
            // 逐行兜底：一条的意外不能带走剩下的认领行，也不能让 `finishSchedule` 不被调用——
            // 「没有结论地退出」正是把行钉死在 `running` 的那扇门。
            let result: ScheduleRunResult;
            try {
                result = await executeSchedule(row, now, 'schedule');
            } catch (error) {
                result = { ok: false, error: describeRunError(error) };
            }
            // 写回失败只记日志：库在那一刻断了的话，这一行会由下一次唤醒的自愈步骤收口，不该把整轮带崩
            await finishSchedule(row, now, result).catch((error) => console.error('[schedules] 写回执行结果失败:', error));
            if (result.ok) ok += 1;
            else failed += 1;
        }
        return reclaimed ? { ran: claimed.length, ok, failed, reclaimed } : { ran: claimed.length, ok, failed };
    } finally {
        tickInFlight = false;
    }
}

/**
 * 手动「立即运行」：不改 `nextRunAt`，也不等排期到点。
 *
 * 与排期跑共用 `executeSchedule`，所以「手动验证一次」看到的工具与提示词
 * 就是明天 09:00 真正会跑的那一套；否则用户按手动结果判断排期可信，是两回事。
 *
 * 写回与排期跑共用同一个 CAS（`lastRunAt` 等于认领那一刻）：调用方是先认领再交给这里的 `row`，
 * 若这一轮之外有人把那行推进过（超预算后由下一次唤醒收口、再被到点认领），这一次的结果就该丢掉，
 * 而不是把更新的排期状态盖回一次几分钟前的手动运行。
 */
export async function runScheduleNow(row: Schedule, trigger: 'manual' | 'retry' = 'manual'): Promise<ScheduleRunResult> {
    const at = row.lastRunAt ?? new Date();
    const result = await executeSchedule(row, at, trigger);
    await finishSchedule(row, at, result);
    return result;
}
