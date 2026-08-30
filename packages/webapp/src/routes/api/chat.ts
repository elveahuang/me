import { createFileRoute } from '@tanstack/react-router';
import type { UIMessage } from 'ai';
import { convertToModelMessages, streamText } from 'ai';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { agentSkills, agents, conversations, messages as messagesTable, skills } from '@schema';
import { hasAnyAiKey, resolveModel } from '@/lib/ai';
import { errorResponse, HttpError, readJson, requireUser } from '@/lib/api';
import { buildSystemPrompt } from '@/lib/prompt';

const ChatBodySchema = z.object({
    agentId: z.number().int().positive(),
    conversationId: z.number().int().positive().optional(),
    /** 客户端（useChat）发来的完整 UI 消息列表 */
    messages: z
        .array(
            z.object({
                id: z.string().min(1),
                role: z.string(),
                parts: z.array(z.unknown()),
            }),
        )
        .min(1),
});

export const Route = createFileRoute('/api/chat')({
    server: {
        handlers: {
            POST: async ({ request }) => {
                try {
                    const session = await requireUser(request);
                    if (!hasAnyAiKey()) {
                        throw new HttpError(
                            503,
                            'AI 服务未配置：请在服务端环境变量中设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY',
                        );
                    }

                    const body = await readJson<unknown>(request);
                    const parsed = ChatBodySchema.safeParse(body);
                    if (!parsed.success) {
                        throw new HttpError(400, `请求参数错误: ${parsed.error.issues[0]?.message ?? ''}`);
                    }
                    const { agentId, conversationId, messages: incoming } = parsed.data;

                    // 1. 智能体必须存在且启用，并加载挂载的 Skills
                    const [agent] = await db
                        .select()
                        .from(agents)
                        .where(and(eq(agents.id, agentId), eq(agents.enabled, true)));
                    if (!agent) throw new HttpError(404, '智能体不存在或未启用');

                    const agentSkillList = await db
                        .select({ skill: skills })
                        .from(agentSkills)
                        .innerJoin(skills, eq(agentSkills.skillId, skills.id))
                        .where(eq(agentSkills.agentId, agent.id));

                    // 2. 解析（或创建）会话，只能聊自己的会话
                    let conversation = conversationId
                        ? (
                              await db
                                  .select()
                                  .from(conversations)
                                  .where(and(eq(conversations.id, conversationId), eq(conversations.userId, session.user.id)))
                          )[0]
                        : undefined;
                    if (conversationId && !conversation) throw new HttpError(404, '会话不存在');

                    if (!conversation) {
                        const firstUserMessage = incoming.find((m) => m.role === 'user');
                        const firstText = firstUserMessage?.parts.find(
                            (p): p is { type: 'text'; text: string } => (p as { type?: string }).type === 'text',
                        )?.text;
                        const [created] = await db
                            .insert(conversations)
                            .values({
                                userId: session.user.id,
                                agentId: agent.id,
                                title: (firstText ?? '新对话').slice(0, 30) || '新对话',
                            })
                            .returning();
                        conversation = created;
                    }
                    if (!conversation) throw new HttpError(500, '会话创建失败');
                    const conv = conversation;

                    // 3. 按消息 id 幂等落库客户端发来的消息（防止重发/断线重连重复）
                    if (incoming.length > 0) {
                        await db
                            .insert(messagesTable)
                            .values(
                                incoming.map((m) => ({
                                    id: m.id,
                                    conversationId: conv.id,
                                    role: m.role,
                                    parts: m.parts,
                                })),
                            )
                            .onConflictDoNothing({ target: messagesTable.id });
                    }

                    // 4. 从数据库取权威历史，转成模型消息
                    const history = await db
                        .select({ role: messagesTable.role, parts: messagesTable.parts })
                        .from(messagesTable)
                        .where(eq(messagesTable.conversationId, conv.id))
                        .orderBy(asc(messagesTable.seq));

                    const uiMessages = history.map((m) => ({
                        id: '',
                        role: m.role as UIMessage['role'],
                        parts: m.parts as UIMessage['parts'],
                    }));
                    const modelMessages = await convertToModelMessages(uiMessages);

                    // 5. 流式生成，流结束后把助手回复落库并更新会话时间戳
                    const result = streamText({
                        model: resolveModel(agent.model),
                        system: buildSystemPrompt(agent, agentSkillList.map((row) => row.skill)),
                        messages: modelMessages,
                        abortSignal: request.signal,
                    });

                    const response = result.toUIMessageStreamResponse({
                        onFinish: async ({ messages: finished }) => {
                            const assistantMessage = [...finished].reverse().find((m) => m.role === 'assistant');
                            if (!assistantMessage) return;
                            await db
                                .insert(messagesTable)
                                .values({
                                    id: assistantMessage.id,
                                    conversationId: conv.id,
                                    role: 'assistant',
                                    parts: assistantMessage.parts,
                                })
                                .onConflictDoUpdate({
                                    target: messagesTable.id,
                                    set: { parts: assistantMessage.parts },
                                });
                            await db
                                .update(conversations)
                                .set({ updatedAt: new Date() })
                                .where(eq(conversations.id, conv.id));
                        },
                    });

                    // 把会话 id 回传给客户端（首次对话时客户端由此得知会话已创建）
                    response.headers.set('x-conversation-id', String(conv.id));
                    return response;
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
