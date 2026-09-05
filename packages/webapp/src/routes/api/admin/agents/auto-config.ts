import { db } from '@/db';
import { resolveModel } from '@/lib/ai';
import { errorResponse, HttpError, json, readJson, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { aiProviders, mcpServers, skills, tools } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { generateText } from 'ai';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const AutoConfigSchema = z.object({
    description: z.string().min(5).max(2000),
});

/** 汇总当前平台上可用的模型选项、Skills、Tools、MCP 服务器，供 AI 生成配置草案 */
async function loadOptions() {
    const providerRows = await db.select().from(aiProviders).where(eq(aiProviders.enabled, true));
    const skillRows = await db.select({ id: skills.id, name: skills.name, description: skills.description }).from(skills);
    const toolRows = await db
        .select({ id: tools.id, name: tools.name, description: tools.description, type: tools.type })
        .from(tools)
        .where(eq(tools.enabled, true));
    const mcpRows = await db
        .select({ id: mcpServers.id, name: mcpServers.name, description: mcpServers.description })
        .from(mcpServers)
        .where(eq(mcpServers.enabled, true));

    const models = [
        ...providerRows.map((p) => ({
            providerId: p.id,
            providerName: p.name,
            model: p.name,
            // 自定义供应商无法枚举远端模型列表，给一个模型 ID 占位说明
            note: '自定义供应商：model 填该供应商的模型 ID（如 qwen-max / glm-4 等）',
            embedding: p.embeddingModel,
        })),
    ];
    const builtin: { providerId: number | null; providerName: string; model: string }[] = [];
    if (process.env.DEEPSEEK_API_KEY) builtin.push({ providerId: null, providerName: 'DeepSeek（内置）', model: 'deepseek-chat' });
    if (process.env.OPENAI_API_KEY) builtin.push({ providerId: null, providerName: 'OpenAI（内置）', model: 'gpt-4o-mini' });

    return { models: [...builtin, ...models], skills: skillRows, tools: toolRows, mcpServers: mcpRows };
}

/** AI 自动配置智能体：根据描述生成 name/emoji/systemPrompt/模型/Skills/Tools 草案 */
export const Route = createFileRoute('/api/admin/agents/auto-config')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            POST: async ({ request }) => {
                try {
                    await requireAdmin(request);
                    if (!process.env.DEEPSEEK_API_KEY && !process.env.OPENAI_API_KEY) {
                        throw new HttpError(503, '自动配置需要至少一个内置 AI key（DEEPSEEK_API_KEY 或 OPENAI_API_KEY）');
                    }

                    const parsed = AutoConfigSchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, '请描述这个智能体的用途（至少 5 个字）');
                    const options = await loadOptions();

                    const system = [
                        '你是智能体平台的配置助手。根据用户描述，为平台生成一个智能体配置草案。',
                        '必须只输出一个 JSON 对象，不要输出任何其他文字或代码块标记，字段如下：',
                        '{"name": string, "emoji": string(单个emoji), "description": string, "systemPrompt": string, "providerId": number|null, "model": string, "skillIds": number[], "toolIds": number[], "mcpServerIds": number[]}',
                        '- providerId 为 null 表示使用内置供应商；model 为对应供应商的模型 ID',
                        '- skillIds / toolIds / mcpServerIds 只能从下方候选列表中选择，且只选与用途相关的；无关就留空数组',
                        '- systemPrompt 要具体、可执行，中文书写',
                    ].join('\n');

                    const user = [
                        `## 智能体用途描述\n${parsed.data.description}`,
                        '',
                        '## 可选模型',
                        ...options.models.map((m) => `- providerId=${m.providerId === null ? 'null' : m.providerId}, model=${m.model}（${m.providerName}）`),
                        '',
                        '## 可选 Skills',
                        options.skills.length > 0
                            ? options.skills.map((s) => `- {id: ${s.id}, name: "${s.name}", description: "${s.description}"} `).join('\n')
                            : '（暂无）',
                        '',
                        '## 可选 Tools',
                        options.tools.length > 0
                            ? options.tools.map((t) => `- {id: ${t.id}, name: "${t.name}", type: "${t.type}", description: "${t.description}"} `).join('\n')
                            : '（暂无）',
                        '',
                        '## 可选 MCP 服务器',
                        options.mcpServers.length > 0
                            ? options.mcpServers.map((m) => `- {id: ${m.id}, name: "${m.name}", description: "${m.description}"}`).join('\n')
                            : '（暂无）',
                    ].join('\n');

                    const result = await generateText({
                        model: resolveModel(process.env.DEEPSEEK_API_KEY ? 'deepseek:deepseek-chat' : 'openai:gpt-4o-mini'),
                        system,
                        prompt: user,
                    });

                    const raw = result.text
                        .trim()
                        .replace(/^```(?:json)?\s*/i, '')
                        .replace(/```\s*$/, '');
                    let draft: unknown;
                    try {
                        draft = JSON.parse(raw);
                    } catch {
                        throw new HttpError(502, 'AI 返回的配置不是合法 JSON，请重试或手动配置');
                    }

                    const checked = z
                        .object({
                            name: z.string().min(1).max(50),
                            emoji: z.string().min(1).max(8).default('🤖'),
                            description: z.string().max(500).default(''),
                            systemPrompt: z.string().max(8000).default(''),
                            providerId: z.number().int().positive().nullable().default(null),
                            model: z.string().min(1).max(100),
                            skillIds: z.array(z.number().int()).default([]),
                            toolIds: z.array(z.number().int()).default([]),
                            mcpServerIds: z.array(z.number().int()).default([]),
                        })
                        .safeParse(draft);
                    if (!checked.success) throw new HttpError(502, 'AI 返回的配置字段不完整，请重试或手动配置');

                    // 只保留真实存在的 skill/tool/mcp id
                    const validSkillIds = checked.data.skillIds.filter((id) => options.skills.some((s) => s.id === id));
                    const validToolIds = checked.data.toolIds.filter((id) => options.tools.some((t) => t.id === id));
                    const validMcpIds = checked.data.mcpServerIds.filter((id) => options.mcpServers.some((m) => m.id === id));
                    return json({ ...checked.data, skillIds: validSkillIds, toolIds: validToolIds, mcpServerIds: validMcpIds });
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
