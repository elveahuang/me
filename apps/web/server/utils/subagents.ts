import { generateText, stepCountIs, tool, type ToolSet } from 'ai';
import { eq } from 'drizzle-orm';
import { createError } from 'h3';
import * as zod from 'zod';
import { loadAgentCapabilities } from '../agent/runtime';
import { appendSessionEventsBestEffort } from '../agent/session/events';
import { agents, conversations, messages } from '../db/schema';
import { db } from './db';
import { buildSystemPrompt } from './system-prompt';

export const SUBAGENT_TOOL_SUMMARY = '- spawn_subagent：把一个只读研究子任务交给同一智能体在独立会话里完成，返回摘要与会话 id';

/** 子智能体只拿到只读工具：父级已经审批了这次委派，不能再让子级无审批地写文件或执行命令。 */
function pickReadOnlyTools(toolSet: ToolSet): ToolSet {
    const readPrefixes = ['local_roots', 'local_list_files', 'local_read_file', 'local_search_files', 'work_today', 'work_list_', 'work_search'];
    const picked: ToolSet = {};
    for (const [name, value] of Object.entries(toolSet)) {
        if (readPrefixes.some((prefix) => name === prefix || name.startsWith(prefix))) picked[name] = value;
    }
    return picked;
}

export function buildSubagentTools(context: { agentId: string; spaceId: string | null }): ToolSet {
    return {
        spawn_subagent: tool({
            description:
                '派一个只读研究子任务：同一智能体在独立会话里运行，拥有只读工具与当前空间知识库，最后返回摘要。适合并行调研、整理资料；不能写文件或执行命令。',
            inputSchema: zod.object({
                prompt: zod.string().describe('子任务的完整指令，包含目标与期望输出'),
            }),
            execute: async (input) => {
                const prompt = input.prompt.trim();
                if (!prompt) return { error: { code: 'SUBAGENT_PROMPT_EMPTY', message: 'prompt 不能为空' } };
                if (prompt.length > 4_000) return { error: { code: 'SUBAGENT_PROMPT_TOO_LONG', message: 'prompt 最长 4000 字符' } };
                try {
                    const [agent] = await db.select().from(agents).where(eq(agents.id, context.agentId));
                    if (!agent) throw createError({ statusCode: 404, statusMessage: '智能体不存在' });
                    const runtime = await loadAgentCapabilities(agent, context.spaceId);
                    const conversationId = crypto.randomUUID();
                    const title = `子任务：${prompt.replace(/\s+/g, ' ').slice(0, 40)}`;
                    await db.insert(conversations).values({ id: conversationId, agentId: agent.id, spaceId: context.spaceId, title });
                    await db.insert(messages).values({
                        id: `cmsg_${crypto.randomUUID()}`,
                        conversationId,
                        role: 'user',
                        parts: [{ type: 'text', text: prompt }],
                        contentText: prompt,
                    });
                    await appendSessionEventsBestEffort(conversationId, [
                        { type: 'user/message', data: { role: 'user', parts: [{ type: 'text', text: prompt }] } },
                        { type: 'run/start', data: { trigger: 'subagent', agentId: agent.id, source: 'subagent' } },
                    ]);

                    const system = buildSystemPrompt(agent, runtime.skills, null, SUBAGENT_TOOL_SUMMARY, undefined, runtime.space);
                    const result = await generateText({
                        model: runtime.model,
                        system: system || undefined,
                        messages: [{ role: 'user', content: prompt }],
                        tools: pickReadOnlyTools(runtime.toolSet),
                        stopWhen: stepCountIs(8),
                        temperature: agent.temperature ?? undefined,
                        maxOutputTokens: agent.maxTokens ?? undefined,
                        abortSignal: AbortSignal.timeout(120_000),
                    });
                    const text = result.text.trim().slice(0, 20_000) || '（子任务没有产出文本）';
                    const assistantId = `cmsg_${crypto.randomUUID()}`;
                    await db.insert(messages).values({
                        id: assistantId,
                        conversationId,
                        role: 'assistant',
                        parts: [{ type: 'text', text }],
                        contentText: text,
                    });
                    await appendSessionEventsBestEffort(conversationId, [
                        { type: 'assistant/message', data: { id: assistantId, role: 'assistant', parts: [{ type: 'text', text }] } },
                        { type: 'run/end', data: { trigger: 'subagent', status: 'completed', usage: result.totalUsage } },
                    ]);
                    return { conversationId, text, steps: result.steps.length };
                } catch (error) {
                    const record = error as { statusMessage?: string; message?: string };
                    return { error: { code: 'SUBAGENT_FAILED', message: record?.statusMessage || '子智能体执行失败' } };
                }
            },
        }),
    } as ToolSet;
}
