import { generateText } from 'ai';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { knowledgeBases, mcpServers, providers, skills, tools } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';
import { resolveModel } from '../../../utils/providers';

const AutoConfigSchema = z.object({
    description: z.string().min(5).max(2000),
});

/**
 * 整次生成的时间预算。generateText 是**非流式**整段等待，AI SDK 不给任何默认超时，
 * 供应商接受连接后不回包时只能等 undici 的分钟级兜底（headersTimeout 默认 300s），
 * 这条管理请求与前端「生成中」状态就被占住整整 5 分钟。实测带预算时在预算点抛
 * TimeoutError（`timeout: 3000` → 3.02s 返回）。传裸数字等价于 `totalMs`，
 * 它同时约束重试与响应读取。
 */
const AUTO_CONFIG_TIMEOUT_MS = 120_000;

/** 汇总当前平台上可用的模型选项、Skills、Tools、MCP 服务器与知识库，供 AI 生成配置草案 */
async function loadOptions() {
    const providerRows = await db.select().from(providers).where(eq(providers.enabled, true));
    const skillRows = await db.select({ id: skills.id, name: skills.name, description: skills.description }).from(skills).where(eq(skills.enabled, true));
    const toolRows = await db
        .select({ id: tools.id, name: tools.name, type: tools.type, description: tools.description })
        .from(tools)
        .where(eq(tools.enabled, true));
    // 只取 id/name：MCP url 常带内部地址或令牌化查询串，不要透出给模型（同 self-config 的边界）
    const mcpRows = await db.select({ id: mcpServers.id, name: mcpServers.name }).from(mcpServers).where(eq(mcpServers.enabled, true));
    const kbRows = await db.select({ id: knowledgeBases.id, name: knowledgeBases.name, description: knowledgeBases.description }).from(knowledgeBases);

    return {
        providers: providerRows.map((p) => ({ id: p.id, name: p.name, models: p.models })),
        skills: skillRows,
        tools: toolRows,
        mcpServers: mcpRows,
        knowledgeBases: kbRows,
    };
}

/** AI 自动配置智能体：根据描述生成 name/avatar/systemPrompt/模型/Skills/MCP/知识库 草案 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const body = (await readBody(event)) ?? {};
    const parsed = AutoConfigSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: '请描述这个智能体的用途（至少 5 个字）' });
    }

    const options = await loadOptions();
    const { model } = await resolveModel();

    const system = [
        '你是智能体平台的配置助手。根据用户描述，为平台生成一个智能体配置草案。',
        '必须只输出一个合法的 JSON 对象，不要输出任何额外的问候、解释或代码块标记，字段如下：',
        '{"name": string, "avatar": string(单个emoji), "description": string, "systemPrompt": string, "providerId": string|null, "model": string, "skillIds": string[], "toolIds": string[], "mcpIds": string[], "kbIds": string[], "temperature": number, "maxTokens": number|null, "maxSteps": number}',
        '- providerId 为对应供应商的 id，model 为该供应商支持的模型 id',
        '- skillIds / toolIds / mcpIds / kbIds 只能从候选列表中挑选匹配的 id，无关留空数组',
        '- Skill 是提示词指令块，Tool 是可执行能力；按用途分别挑选',
        '- systemPrompt 要具体、专业、有针对性，以中文书写',
        '- temperature 适合该角色的温度（0.1~1.0），maxSteps 默认为 6',
    ].join('\n');

    const promptUser = [
        `## 智能体用途描述\n${parsed.data.description}`,
        '',
        '## 可选供应商与模型',
        options.providers.map((p) => `- 供应商 id: "${p.id}", 名称: "${p.name}", 支持模型: ${p.models.join(', ')}`).join('\n') || '（无供应商）',
        '',
        '## 可选 Skills',
        options.skills.map((s) => `- id: "${s.id}", 名称: "${s.name}", 描述: "${s.description}"`).join('\n') || '（暂无）',
        '',
        '## 可选 Tools',
        options.tools.map((t) => `- id: "${t.id}", 名称: "${t.name}", 类型: "${t.type}", 描述: "${t.description}"`).join('\n') || '（暂无）',
        '',
        '## 可选 MCP 服务器',
        options.mcpServers.map((m) => `- id: "${m.id}", 名称: "${m.name}"`).join('\n') || '（暂无）',
        '',
        '## 可选知识库',
        options.knowledgeBases.map((k) => `- id: "${k.id}", 名称: "${k.name}", 描述: "${k.description}"`).join('\n') || '（暂无）',
    ].join('\n');

    let modelText: string;
    try {
        const result = await generateText({
            model,
            system,
            prompt: promptUser,
            timeout: AUTO_CONFIG_TIMEOUT_MS,
        });
        modelText = result.text;
    } catch (error) {
        // 预算落败时只换一句可读文案，其余错误（供应商拒绝、限流）保持原样向上抛，
        // 否则运营会把「key 失效」重试成「再等等就好」。
        if ((error as { name?: string })?.name === 'TimeoutError' || (error as { name?: string })?.name === 'AbortError') {
            throw createError({ statusCode: 504, statusMessage: 'AI 生成配置超时，请稍后重试或简化描述' });
        }
        throw error;
    }

    const raw = modelText
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/, '');

    let draft: unknown;
    try {
        draft = JSON.parse(raw);
    } catch {
        throw createError({ statusCode: 502, statusMessage: 'AI 返回的配置不是合法 JSON，请重试' });
    }

    const checked = z
        .object({
            name: z.string().min(1).max(50),
            avatar: z.string().min(1).max(8).default('🤖'),
            description: z.string().max(500).default(''),
            systemPrompt: z.string().max(8000).default(''),
            providerId: z.string().nullable().default(null),
            model: z.string().min(1).max(100).default('deepseek-chat'),
            skillIds: z.array(z.string()).default([]),
            toolIds: z.array(z.string()).default([]),
            mcpIds: z.array(z.string()).default([]),
            kbIds: z.array(z.string()).default([]),
            temperature: z.number().min(0).max(2).default(0.7),
            maxTokens: z.number().int().positive().nullable().default(null),
            maxSteps: z.number().int().min(1).max(30).default(6),
        })
        .safeParse(draft);

    if (!checked.success) {
        throw createError({ statusCode: 502, statusMessage: 'AI 返回的配置字段不完整，请重试' });
    }

    // 只保留真实存在的 id
    const validSkillIds = checked.data.skillIds.filter((id) => options.skills.some((s) => s.id === id));
    const validToolIds = checked.data.toolIds.filter((id) => options.tools.some((t) => t.id === id));
    const validMcpIds = checked.data.mcpIds.filter((id) => options.mcpServers.some((m) => m.id === id));
    const validKbIds = checked.data.kbIds.filter((id) => options.knowledgeBases.some((k) => k.id === id));
    // providerId 也在这份白名单内：模型偶尔凭空造一个 id，草案带着它保存会被
    // 管理端接口按"供应商不存在"拒绝，这里归零让前端自然回退到默认供应商。
    const validProviderId = checked.data.providerId && options.providers.some((p) => p.id === checked.data.providerId) ? checked.data.providerId : null;

    return {
        ...checked.data,
        providerId: validProviderId,
        skillIds: validSkillIds,
        toolIds: validToolIds,
        mcpIds: validMcpIds,
        kbIds: validKbIds,
    };
});
