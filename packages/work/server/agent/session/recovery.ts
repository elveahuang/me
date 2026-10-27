import type { NewSessionEvent, SessionEventRow } from './events';
import { appendSessionEventsBestEffort, readAllSessionEvents } from './events';

/**
 * 崩溃恢复：只处理「有 run/start、没有 run/end」的轮次里，有 tool/call 没有 tool/result 的调用。
 *
 * 为什么不用 `session_runs` 的时间窗口判断：事件日志自己就能回答「这一轮是否收尾」，
 * 而且不会把正常完成、只是结果事件写失败的历史调用误判成崩溃（那种轮次有 run/end）。
 *
 * 恢复动作只写审计事实：`tool/result` 的 `TOOL_OUTCOME_UNKNOWN` + 一条 `system/message`。
 * **绝不重跑工具**：写操作可能已经产生了副作用，自动重试等于二次执行。
 */

function openTurns(events: SessionEventRow[]): Set<string> {
    const ended = new Set<string>();
    for (const event of events) {
        if (event.type === 'run/end' && event.turnId) ended.add(event.turnId);
    }
    const open = new Set<string>();
    for (const event of events) {
        if (event.type === 'run/start' && event.turnId && !ended.has(event.turnId)) open.add(event.turnId);
    }
    return open;
}

export async function recoverInterruptedToolCallsForConversation(conversationId: string): Promise<number> {
    const events = await readAllSessionEvents(conversationId);
    const open = openTurns(events);
    if (!open.size) return 0;

    const calls = new Map<string, { toolCallId: string; toolName: string; turnId: string }>();
    const results = new Set<string>();
    for (const event of events) {
        if (!event.turnId || !open.has(event.turnId)) continue;
        const toolCallId = typeof event.data.toolCallId === 'string' ? event.data.toolCallId : '';
        if (!toolCallId) continue;
        if (event.type === 'tool/call') {
            calls.set(toolCallId, {
                toolCallId,
                toolName: typeof event.data.toolName === 'string' ? event.data.toolName : '',
                turnId: event.turnId,
            });
        } else if (event.type === 'tool/result') {
            results.add(toolCallId);
        }
    }

    const pending = [...calls.values()].filter((call) => !results.has(call.toolCallId));
    if (!pending.length) return 0;

    const recoveryEvents: NewSessionEvent[] = pending.map((call) => ({
        type: 'tool/result',
        turnId: call.turnId,
        data: {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            isError: true,
            output: { code: 'TOOL_OUTCOME_UNKNOWN' },
            durationMs: null,
            recovered: true,
        },
    }));
    for (const turnId of new Set(pending.map((call) => call.turnId))) {
        recoveryEvents.push({
            type: 'system/message',
            turnId,
            data: {
                id: `interrupted:${turnId}`,
                text: '上一轮在工具执行中中断，工具结果未知。不要自动重跑写操作；先核验副作用，再决定是否只重试只读/幂等操作。',
            },
        });
    }

    const seqs = await appendSessionEventsBestEffort(conversationId, recoveryEvents);
    if (!seqs.length) return 0;
    console.warn(`[session-recovery] ${conversationId}: 为 ${pending.length} 个未配对工具写入 TOOL_OUTCOME_UNKNOWN，并标记 ${open.size} 个未收尾轮次`);
    return seqs.length;
}

/** 启动时对刚被标成 interrupted 的会话做工具恢复；单会话失败不影响其他会话。 */
export async function recoverInterruptedToolCalls(conversationIds: string[]): Promise<number> {
    let recovered = 0;
    for (const conversationId of new Set(conversationIds)) {
        try {
            recovered += await recoverInterruptedToolCallsForConversation(conversationId);
        } catch (error) {
            console.error(`[session-recovery] 会话 ${conversationId} 恢复失败（下次启动重试）:`, error);
        }
    }
    return recovered;
}
