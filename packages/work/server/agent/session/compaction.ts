import { generateText, type LanguageModel } from 'ai';
import { appendSessionEvents, deriveMessages, readAllSessionEvents, type DerivedSessionMessage } from './events';
import { estimateTokens } from './token-meter';

/**
 * 会话压缩（P1-3）。
 *
 * 设计上只做两件事：把「旧消息区间」在投影里遮蔽，并在区间之后追加一条 system/message 摘要。
 * 原始事件永远保留（append-only），所以压缩可审计、可重复执行，也不会破坏工具 call/result 配对。
 * 读路径只在存在 compaction/end 时才切到事件投影；没有压缩过的会话仍然读 messages。
 */

export interface CompactionPlan {
    fromSeq: number;
    toSeq: number;
    messages: number;
    tokensBefore: number;
    tokensAfter: number;
}

export interface CompactionResult {
    compacted: boolean;
    reason?: string;
    plan?: CompactionPlan;
    tokensBefore?: number;
    tokensAfter?: number;
    summary?: string;
}

function partsText(message: DerivedSessionMessage): string {
    return (message.parts as Array<Record<string, unknown>>)
        .map((part) => {
            if (part?.type === 'text' && typeof part.text === 'string') return part.text;
            if (typeof part?.type === 'string' && part.type.startsWith('tool-')) {
                const input = part.input === undefined ? '' : ` ${JSON.stringify(part.input).slice(0, 500)}`;
                const output = part.output === undefined ? '' : ` → ${JSON.stringify(part.output).slice(0, 1000)}`;
                return `[${part.type.slice(5)}${input}${output}]`;
            }
            return '';
        })
        .filter(Boolean)
        .join('\n');
}

function messageTokens(message: DerivedSessionMessage): number {
    return estimateTokens(partsText(message)) + 4;
}

/**
 * 纯函数：按 token 压力决定要不要压缩、以及压缩到哪。
 *
 * 保留最近约 `retainRatio` 的 token；至少保留 2 条消息，且只压缩前缀。
 * 没有达到 `budget * 0.7` 的压力时不压缩，避免把短会话压成一句摘要。
 */
export function planCompaction(messages: DerivedSessionMessage[], budgetTokens: number, retainRatio = 0.3): CompactionPlan | null {
    const visible = messages.filter((message) => ['user', 'assistant', 'system'].includes(message.role));
    if (visible.length < 4 || budgetTokens <= 0) return null;
    const counts = visible.map(messageTokens);
    const tokensBefore = counts.reduce((sum, value) => sum + value, 0);
    if (tokensBefore <= budgetTokens * 0.7) return null;
    const retainBudget = Math.max(1, Math.floor(budgetTokens * 0.7 * retainRatio));

    let kept = 0;
    let cut = visible.length;
    for (let index = visible.length - 1; index >= 0; index -= 1) {
        const next = kept + counts[index]!;
        if (next > retainBudget && cut <= visible.length - 2) break;
        kept = next;
        cut = index;
    }
    // 至少压掉一条、至少留两条；否则这一轮没有可压缩的边界
    if (cut <= 0 || cut >= visible.length - 1) return null;
    return {
        fromSeq: visible[0]!.seq,
        toSeq: visible[cut - 1]!.seq,
        messages: cut,
        tokensBefore,
        tokensAfter: kept,
    };
}

export function buildCompactionPrompt(messages: DerivedSessionMessage[]): string {
    const body = messages
        .map((message) => `【${message.role}】\n${partsText(message).slice(0, 6000)}`)
        .join('\n\n')
        .slice(0, 80_000);
    return [
        '把下面的会话压缩成一段可供后续模型继续工作的中文摘要。',
        '必须保留：用户目标与偏好、已确认的事实、关键数字与路径、做出的决定、未完成事项、工具结果中不可再生的数据。',
        '不要编造、不要添加建议、不要复述寒暄；只输出摘要正文，不要标题。',
        '',
        body,
    ].join('\n');
}

const compacting = new Set<string>();

export interface CompactConversationOptions {
    model: LanguageModel;
    budgetTokens?: number;
    reason?: 'manual' | 'auto';
    modelName?: string;
}

/**
 * 自动压缩触发条件：窗口估算超过预算 70%，或已经顶到读取窗口上限（更早的消息已被截断，
 * 再拖下去模型会看不到它们）。预算与 planCompaction 同口径。
 */
export function shouldAutoCompact(pressureTokens: number, messageCount: number, maxMessages: number, budgetTokens = 128_000 * 0.7): boolean {
    return pressureTokens > budgetTokens * 0.7 || messageCount >= maxMessages;
}

/**
 * 压缩一个会话。失败时写 `compaction/end`（不带 surface_op），不会留下半截替换；
 * 同一进程内按会话串行，避免用户连点两次生成两份摘要。
 */
export async function compactConversation(conversationId: string, options: CompactConversationOptions): Promise<CompactionResult> {
    if (compacting.has(conversationId)) return { compacted: false, reason: 'already_running' };
    compacting.add(conversationId);
    const budgetTokens = options.budgetTokens ?? 128_000 * 0.7;
    try {
        const events = await readAllSessionEvents(conversationId);
        if (!events.length) return { compacted: false, reason: 'no_events' };
        const derived = deriveMessages(events);
        const plan = planCompaction(derived, budgetTokens);
        if (!plan) return { compacted: false, reason: 'below_threshold' };

        await appendSessionEvents(conversationId, [
            {
                type: 'compaction/start',
                data: {
                    reason: options.reason ?? 'manual',
                    fromSeq: plan.fromSeq,
                    toSeq: plan.toSeq,
                    messages: plan.messages,
                    tokensBefore: plan.tokensBefore,
                },
            },
        ]);

        let summary = '';
        try {
            const result = await generateText({
                model: options.model,
                system: '你是会话压缩器。只输出摘要正文，保留事实、决定、未完成事项与关键数据，不编造。',
                prompt: buildCompactionPrompt(derived.slice(0, plan.messages)),
                temperature: 0.2,
                maxOutputTokens: 800,
                abortSignal: AbortSignal.timeout(60_000),
            });
            summary = result.text.trim();
        } catch (error) {
            const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
            await appendSessionEvents(conversationId, [
                { type: 'compaction/end', data: { status: 'failed', fromSeq: plan.fromSeq, toSeq: plan.toSeq, error: message } },
            ]).catch(() => undefined);
            return { compacted: false, reason: 'summary_failed', plan };
        }
        if (!summary) {
            await appendSessionEvents(conversationId, [
                { type: 'compaction/end', data: { status: 'failed', fromSeq: plan.fromSeq, toSeq: plan.toSeq, error: '模型没有返回摘要' } },
            ]).catch(() => undefined);
            return { compacted: false, reason: 'empty_summary', plan };
        }

        const summaryId = `compaction:${crypto.randomUUID()}`;
        await appendSessionEvents(conversationId, [
            {
                type: 'system/message',
                data: {
                    id: summaryId,
                    parts: [{ type: 'text', text: summary }],
                    text: summary,
                    source: 'compaction',
                    compaction: true,
                    fromSeq: plan.fromSeq,
                    toSeq: plan.toSeq,
                    model: options.modelName ?? null,
                },
            },
            {
                type: 'compaction/end',
                surfaceOp: { op: 'replace', fromSeq: plan.fromSeq, toSeq: plan.toSeq },
                data: {
                    status: 'completed',
                    fromSeq: plan.fromSeq,
                    toSeq: plan.toSeq,
                    tokensBefore: plan.tokensBefore,
                    tokensAfter: plan.tokensAfter + estimateTokens(summary),
                    summaryChars: summary.length,
                },
            },
        ]);

        return {
            compacted: true,
            plan,
            tokensBefore: plan.tokensBefore,
            tokensAfter: plan.tokensAfter + estimateTokens(summary),
            summary,
        };
    } finally {
        compacting.delete(conversationId);
    }
}
