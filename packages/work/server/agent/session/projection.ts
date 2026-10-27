import type { SessionSurfaceOp } from '../../db/schema';

/**
 * 事件 → 消息投影（纯函数，无数据库依赖）。
 *
 * 单独放在这里是为了让冒烟测试能直接对账，不必为了测一个折叠函数去连库；
 * `events.ts` 负责读写与事务，这里只负责“给定事件流，历史长什么样”。
 */

export interface DeriveInput {
    seq: number;
    type: string;
    /** 同一轮的用户/助手/工具事件共享；回填的旧事件没有这个字段 */
    turnId?: string | null;
    surfaceOp: SessionSurfaceOp | null;
    data: Record<string, unknown>;
    createdAt: Date;
}

export interface DerivedSessionMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    parts: unknown[];
    /** 首条事件 seq，便于调试；不是消息表的 seq */
    seq: number;
    createdAt: Date;
    /** 压缩摘要；投影时移到最前，代表被遮蔽的旧区间 */
    compaction?: boolean;
}

/**
 * 把事件折叠成消息列表。
 *
 * 规则：
 * - `user/assistant/system` 的 message 事件进入投影；
 * - `surface_op=replace` 的区间被压缩摘要遮蔽（原事件保留，仍可审计）；
 * - `request/header`、`run/*`、`tool/*`、`compaction/*` 暂不进入消息（工具配对在 P1-2 做）；
 * - `parts` 非数组时回退到 `data.text`。
 */
export function deriveMessages(events: DeriveInput[]): DerivedSessionMessage[] {
    const hidden = events.flatMap((event) => (event.surfaceOp?.op === 'replace' ? [[event.surfaceOp.fromSeq, event.surfaceOp.toSeq] as const] : []));
    const isHidden = (seq: number) => hidden.some(([from, to]) => seq >= from && seq <= to);

    const messageEvents = events
        .filter((event) => ['user/message', 'assistant/message', 'system/message'].includes(event.type))
        .filter((event) => !isHidden(event.seq))
        .sort((a, b) => a.seq - b.seq);

    /**
     * 逐 step 检查点只在「这一轮没有最终 assistant 消息」时可见（崩溃/中断）。
     * 正常完成的轮次以 onFinish 的最终消息为准，否则同一轮会渲染出多段半截回复。
     */
    const finalAssistantTurns = new Set(
        messageEvents
            .filter((event) => event.type === 'assistant/message' && event.data.checkpoint !== true && event.turnId)
            .map((event) => event.turnId as string),
    );

    return messageEvents
        .filter((event) => !(event.type === 'assistant/message' && event.data.checkpoint === true && event.turnId && finalAssistantTurns.has(event.turnId)))
        .map((event) => {
            const role = event.type === 'user/message' ? 'user' : event.type === 'assistant/message' ? 'assistant' : 'system';
            const parts = Array.isArray(event.data.parts)
                ? event.data.parts
                : typeof event.data.text === 'string'
                  ? [{ type: 'text', text: event.data.text }]
                  : [];
            const id = typeof event.data.id === 'string' && event.data.id ? event.data.id : `${role}:${event.seq}`;
            return {
                id,
                role,
                parts,
                seq: event.seq,
                createdAt: event.createdAt,
                ...(event.data.compaction === true ? { compaction: true } : {}),
            } satisfies DerivedSessionMessage;
        })
        .sort((a, b) => {
            // 压缩摘要代表「更早的历史」，应排在保留的近期消息之前；多份摘要按自身 seq 保持先后
            if (a.compaction && !b.compaction) return -1;
            if (!a.compaction && b.compaction) return 1;
            return a.seq - b.seq;
        });
}

export interface ToolCallPair {
    toolCallId: string;
    toolName: string;
    callSeq: number | null;
    resultSeq: number | null;
    isError: boolean | null;
}

/**
 * 把 `tool/call` 与 `tool/result` 按 `toolCallId` 配对。
 *
 * 只做审计/恢复判断，不参与当前消息投影（assistant 的最终 parts 里已经带着工具结果）。
 * 崩溃恢复要用的正是 `resultSeq === null` 的那些调用：不能自动重跑，只能标 `TOOL_OUTCOME_UNKNOWN`。
 */
export function pairToolEvents(events: DeriveInput[]): ToolCallPair[] {
    const pairs = new Map<string, ToolCallPair>();
    for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
        const toolCallId = typeof event.data.toolCallId === 'string' ? event.data.toolCallId : '';
        if (!toolCallId) continue;
        if (event.type === 'tool/call') {
            const existing = pairs.get(toolCallId);
            pairs.set(toolCallId, {
                toolCallId,
                toolName: typeof event.data.toolName === 'string' ? event.data.toolName : (existing?.toolName ?? ''),
                callSeq: event.seq,
                resultSeq: existing?.resultSeq ?? null,
                isError: existing?.isError ?? null,
            });
        } else if (event.type === 'tool/result') {
            const existing = pairs.get(toolCallId);
            pairs.set(toolCallId, {
                toolCallId,
                toolName: typeof event.data.toolName === 'string' ? event.data.toolName : (existing?.toolName ?? ''),
                callSeq: existing?.callSeq ?? null,
                resultSeq: event.seq,
                isError: event.data.isError === true,
            });
        }
    }
    return [...pairs.values()];
}

/** 有调用、没有结果的工具；崩溃恢复时据此写 `TOOL_OUTCOME_UNKNOWN`，不要自动重跑。 */
export function unpairedToolCalls(events: DeriveInput[]): ToolCallPair[] {
    return pairToolEvents(events).filter((pair) => pair.resultSeq === null);
}
