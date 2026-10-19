import { generateText, stepCountIs } from 'ai';
import { and, asc, desc, eq, isNull, lt, lte, ne, or } from 'drizzle-orm';
import { wrapToolsWithApproval } from '../agent/policy/approval';
import { loadAgentCapabilities } from '../agent/runtime';
import { clipEventValue, toolErrorSummary } from '../agent/session/event-values';
import { appendSessionEventsBestEffort } from '../agent/session/events';
import { estimateTokens } from '../agent/session/token-meter';
import { applyToolRegistry } from '../agent/tool-registry';
import { agents, automationRuns, conversations, messages, schedules, type Schedule } from '../db/schema';
import { buildAssistTools } from './assist-tools';
import { db } from './db';
import { retrieveContext } from './embedding';
import { buildJobTools } from './job-tools';
import { closeMcpConnections, connectEnabledMcpServers, mergeMcpTools } from './mcp';
import { lockAgentRow } from './ref-lock';
import { planOf } from './schedule-store';
import { buildSkillTools, matchSkillDirective, skillDirectiveSection } from './skill-tools';
import { buildSubagentTools } from './subagents';
import { buildSystemPrompt } from './system-prompt';
import { shanghaiDateKey } from './work-day';
import { computeNextRunAt } from './work-schedule';

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

/**
 * 正在本进程执行的运行记录 → 中断句柄。
 *
 * 取消是进程内能力：`automation_runs.status='running'` 可能是上一进程遗留（启动自愈会收口），
 * 此时库里看着在跑、却没有东西可中断。接口据此返回 409，而不是把一行历史改成失败。
 */
const activeScheduleRuns = new Map<string, AbortController>();

/** 取消一轮正在执行的定时任务；返回 false 表示它不在本进程里跑。 */
export function cancelScheduleRun(runId: string): boolean {
    const controller = activeScheduleRuns.get(runId);
    if (!controller) return false;
    // 已经按过取消就保持幂等：第二次点击不该报「不在本进程执行」
    if (!controller.signal.aborted) controller.abort();
    return true;
}

/** 供接口区分「不在跑」与「在跑但属于别的进程」。 */
export function isScheduleRunActive(runId: string): boolean {
    return activeScheduleRuns.has(runId);
}

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
            .where(and(eq(schedules.enabled, true), isNull(schedules.deletedAt), lte(schedules.nextRunAt, now), notRunningNow(runningStaleBefore(now))))
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
    const runStartedAt = new Date();
    const cancelController = new AbortController();
    activeScheduleRuns.set(runId, cancelController);
    try {
        await db.insert(automationRuns).values({
            id: runId,
            scheduleId: row.id,
            status: 'running',
            trigger,
            scheduledFor: trigger === 'schedule' ? at : null,
            startedAt: runStartedAt,
            prompt: row.prompt,
        });
        const [agent] = await db.select().from(agents).where(eq(agents.id, row.agentId));
        if (!agent) return { ok: false, runId, error: '智能体已被删除' };
        if (!agent.enabled) return { ok: false, runId, error: '智能体已停用' };

        // 能力装配与 /api/chat 共用一份（server/agent/runtime.ts），避免「聊天加了工具、定时任务没加」
        const runtime = await loadAgentCapabilities(agent, row.spaceId);
        const { space, spaceKbIds } = runtime;
        let toolSet = runtime.toolSet;

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

        // 周期任务增量连续性：若存在上一轮成功产出的会话，提取其回复前 800 字供模型参考，避免每天复读相同结论
        if (row.lastConversationId && row.kind !== 'once') {
            try {
                const [prevMsg] = await db
                    .select({ parts: messages.parts })
                    .from(messages)
                    .where(and(eq(messages.conversationId, row.lastConversationId), eq(messages.role, 'assistant')))
                    .orderBy(desc(messages.seq))
                    .limit(1);
                const prevText = Array.isArray(prevMsg?.parts)
                    ? (prevMsg.parts as Array<{ type?: string; text?: string }>)
                          .filter((p) => p?.type === 'text' && typeof p.text === 'string')
                          .map((p) => p.text)
                          .join('')
                          .trim()
                          .slice(0, 800)
                    : '';
                if (prevText) {
                    const continuityBlock = `【上一轮定时执行产出摘要（请优先汇报增量变化，避免重复相同内容）】\n${prevText}`;
                    knowledgeContext = knowledgeContext ? `${knowledgeContext}\n\n${continuityBlock}` : continuityBlock;
                }
            } catch {
                // 忽略读取上一轮摘要异常
            }
        }

        mcpConnections = await connectEnabledMcpServers(runtime.mcpServerIds);
        if (mcpConnections.length) toolSet = mergeMcpTools(toolSet, mcpConnections);
        const toolSummary = [runtime.toolSummary, ...mcpConnections.map((connection) => `- [MCP] ${connection.serverName}`)].join('\n');

        // 闭包里用局部 const：外层 `conversationId` 是 `string | null`（finally 里还要读它判断
        // 「这一轮有没有留下会话」），TS 不会把回调里的赋值算作收窄，直接插会报 id 可为 null。
        const conversationRowId = crypto.randomUUID();
        const userMessageId = `cmsg_${crypto.randomUUID()}`;
        const title = `${row.title} · ${shanghaiDateKey(at)}`;
        await db.transaction(async (tx) => {
            await lockAgentRow(tx, row.agentId);
            await tx.insert(conversations).values({ id: conversationRowId, agentId: row.agentId, spaceId: row.spaceId, title });
            await tx.insert(messages).values({
                id: userMessageId,
                conversationId: conversationRowId,
                role: 'user',
                parts: [{ type: 'text', text: row.prompt }],
                contentText: row.prompt,
            });
        });
        conversationId = conversationRowId;

        // 定时任务与聊天共用同一套事件口径；写失败不影响这一轮执行。
        await appendSessionEventsBestEffort(conversationRowId, [
            {
                type: 'user/message',
                turnId: runId,
                data: { id: userMessageId, parts: [{ type: 'text', text: row.prompt }] },
            },
            {
                type: 'run/start',
                turnId: runId,
                data: { runId, trigger, scheduleId: row.id, agentId: row.agentId, source: 'schedule' },
            },
        ]);

        // 后台没有审批界面：ask 模式下的写/执行工具立即失败关闭，auto 模式仍按风险自动放行
        toolSet = { ...toolSet, ...buildJobTools({ conversationId: conversationRowId, agentId: row.agentId }) };
        toolSet = { ...toolSet, ...buildAssistTools(conversationRowId) };
        toolSet = { ...toolSet, ...buildSkillTools(runtime.skills) };
        toolSet = { ...toolSet, ...buildSubagentTools({ agentId: row.agentId, spaceId: row.spaceId }) };
        toolSet = applyToolRegistry(toolSet);
        toolSet = wrapToolsWithApproval(toolSet, {
            conversationId: conversationRowId,
            runId,
            mode: (agent.approvalMode as 'auto' | 'ask' | 'never') ?? 'auto',
            noAnswerer: true,
        });

        const baseSystemPrompt = buildSystemPrompt(agent, runtime.skills, knowledgeContext, toolSummary, undefined, space);
        const scheduledSkill = matchSkillDirective(row.prompt, runtime.skills);
        const systemPromptText = scheduledSkill ? `${baseSystemPrompt}\n\n${skillDirectiveSection(scheduledSkill)}` : baseSystemPrompt;

        let generatedText = '';
        let finalUsage = { steps: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 };
        let sawToolExecution = false;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                if (attempt > 1) {
                    await db.update(automationRuns).set({ attempt }).where(eq(automationRuns.id, runId));
                    await new Promise((r) => setTimeout(r, 1500));
                    // 等退避的这 1.5 秒里用户可能已经点了取消，不能醒来再打一次供应商
                    if (cancelController.signal.aborted) throw new RunFailure('用户已取消');
                }
                await appendSessionEventsBestEffort(conversationRowId, [
                    {
                        type: 'request/header',
                        turnId: runId,
                        data: {
                            model: agent.model,
                            providerId: agent.providerId,
                            maxSteps: agent.maxSteps ?? 6,
                            messageCount: 1,
                            estimatedContextTokens: estimateTokens(systemPromptText) + estimateTokens(row.prompt),
                            toolNames: Object.keys(toolSet),
                            systemChars: systemPromptText.length,
                            temperature: agent.temperature ?? null,
                            maxOutputTokens: agent.maxTokens ?? null,
                            trigger,
                            attempt,
                        },
                    },
                ]);

                const result = await generateText({
                    model: runtime.model,
                    system: systemPromptText,
                    prompt: row.prompt,
                    tools: toolSet,
                    stopWhen: stepCountIs(agent.maxSteps),
                    temperature: agent.temperature ?? undefined,
                    maxOutputTokens: agent.maxTokens ?? undefined,
                    timeout: { firstChunkMs: FIRST_CHUNK_TIMEOUT_MS, chunkMs: CHUNK_TIMEOUT_MS, toolMs: TOOL_TIMEOUT_MS },
                    abortSignal: AbortSignal.any([cancelController.signal, AbortSignal.timeout(RUN_TOTAL_BUDGET_MS)]),
                    onToolExecutionStart: async ({ toolCall }) => {
                        sawToolExecution = true;
                        await appendSessionEventsBestEffort(conversationRowId, [
                            {
                                type: 'tool/call',
                                turnId: runId,
                                stepId: `attempt-${attempt}`,
                                data: { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, input: clipEventValue(toolCall.input) },
                            },
                        ]);
                    },
                    onToolExecutionEnd: async ({ toolCall, toolOutput, toolExecutionMs }) => {
                        const isError = toolOutput.type === 'tool-error';
                        const raw = isError ? toolOutput.error : toolOutput.output;
                        await appendSessionEventsBestEffort(conversationRowId, [
                            {
                                type: 'tool/result',
                                turnId: runId,
                                stepId: `attempt-${attempt}`,
                                data: {
                                    toolCallId: toolCall.toolCallId,
                                    toolName: toolCall.toolName,
                                    isError,
                                    output: isError ? toolErrorSummary(raw) : clipEventValue(raw),
                                    durationMs: toolExecutionMs,
                                },
                            },
                        ]);
                    },
                    onStepEnd: async (step) => {
                        const stepUsage = {
                            inputTokens: step.usage.inputTokens ?? 0,
                            outputTokens: step.usage.outputTokens ?? 0,
                            totalTokens: step.usage.totalTokens ?? 0,
                            cachedInputTokens: step.usage.inputTokenDetails?.cacheReadTokens ?? 0,
                            reasoningTokens: step.usage.outputTokenDetails?.reasoningTokens ?? 0,
                        };
                        const parts: Record<string, unknown>[] = [];
                        if (step.text) parts.push({ type: 'text', text: step.text });
                        for (const call of step.toolCalls) {
                            const toolResult = step.toolResults.find((item) => item.toolCallId === call.toolCallId);
                            parts.push({
                                type: `tool-${call.toolName}`,
                                toolCallId: call.toolCallId,
                                input: clipEventValue(call.input),
                                state: toolResult ? 'output-available' : 'input-available',
                                ...(toolResult ? { output: clipEventValue(toolResult.output) } : {}),
                            });
                        }
                        if (!parts.length) return;
                        await appendSessionEventsBestEffort(conversationRowId, [
                            {
                                type: 'assistant/message',
                                turnId: runId,
                                stepId: String(step.stepNumber),
                                data: {
                                    id: `checkpoint:${runId}:${attempt}:${step.stepNumber}`,
                                    checkpoint: true,
                                    stepNumber: step.stepNumber,
                                    attempt,
                                    finishReason: step.finishReason,
                                    usage: stepUsage,
                                    parts,
                                },
                            },
                        ]);
                    },
                });
                generatedText = result.text.trim().slice(0, RESULT_TEXT_MAX);
                if (!generatedText) throw new RunFailure('模型没有返回可用正文');
                finalUsage = {
                    steps: result.steps.length,
                    inputTokens: result.usage.inputTokens ?? 0,
                    outputTokens: result.usage.outputTokens ?? 0,
                    totalTokens: result.usage.totalTokens ?? 0,
                    cachedInputTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
                    reasoningTokens: result.usage.outputTokenDetails?.reasoningTokens ?? 0,
                };
                break;
            } catch (err) {
                // 已经执行过工具就不再整轮重试：工具可能有外部副作用（发消息、写文件），
                // 重试等于让副作用发生两次；宁可把这一轮判失败，让用户手动重跑。
                if (attempt >= 2 || sawToolExecution || cancelController.signal.aborted) throw err;
            }
        }
        const content = generatedText;
        const assistantMessageId = `cmsg_${crypto.randomUUID()}`;
        await db
            .insert(messages)
            .values({ id: assistantMessageId, conversationId, role: 'assistant', parts: [{ type: 'text', text: content }], contentText: content });
        await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
        await appendSessionEventsBestEffort(conversationRowId, [
            {
                type: 'assistant/message',
                turnId: runId,
                data: { id: assistantMessageId, parts: [{ type: 'text', text: content }], final: true, usage: finalUsage },
            },
            {
                type: 'run/end',
                turnId: runId,
                data: { runId, status: 'completed', reason: null, durationMs: Math.max(0, Date.now() - runStartedAt.getTime()), usage: finalUsage },
            },
        ]);
        return { ok: true, conversationId, runId };
    } catch (error) {
        // 这一条 catch 是整个执行侧的收尾保证：`resolveModel`、MCP 建连、两条 insert 都在外呼之前，
        // 以前它们抛错会把异常一路抛进 runner，那一行就永久停在 `running`——
        // `/tasks` 的清单查不到它、手动运行永远 409、下一分钟也不会再认领，而且界面上一句原因都没有。
        // 原因本身走 describeRunError：这个字段会被列表渲染、也会被 work_today 发给外部供应商，
        // 原始 message 里装着 drizzle 的整条 SQL 与绑定参数（也就是这条排期的 prompt 正文）。
        const id = conversationId;
        const reasonText = cancelController.signal.aborted ? '用户已取消' : describeRunError(error);
        if (id) {
            await appendSessionEventsBestEffort(id, [
                {
                    type: 'run/end',
                    turnId: runId,
                    data: {
                        runId,
                        status: 'failed',
                        reason: 'schedule_failed',
                        durationMs: Math.max(0, Date.now() - runStartedAt.getTime()),
                        error: reasonText,
                    },
                },
            ]);
        }
        return { ok: false, runId, ...(id ? { conversationId: id } : {}), error: reasonText };
    } finally {
        activeScheduleRuns.delete(runId);
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
