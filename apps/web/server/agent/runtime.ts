import type { ToolSet } from 'ai';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
    agentKnowledgeBases,
    agentMcpServers,
    agentSkills,
    agentTools,
    knowledgeBases,
    skills,
    spaces,
    tools as toolsTable,
    type Agent,
    type Skill,
    type Tool,
} from '../db/schema';
import { ASSIST_TOOL_SUMMARY } from '../utils/assist-tools';
import { COMMAND_TOOL_SUMMARY, buildCommandTools, isCommandEnabled } from '../utils/command-tools';
import { db } from '../utils/db';
import { JOB_TOOL_SUMMARY } from '../utils/job-tools';
import { LOCAL_TOOL_SUMMARY, LOCAL_WRITE_TOOL_SUMMARY, buildLocalFileTools } from '../utils/local-tools';
import { resolveModel } from '../utils/providers';
import { SKILL_TOOL_SUMMARY } from '../utils/skill-tools';
import { SUBAGENT_TOOL_SUMMARY } from '../utils/subagents';
import { buildToolSet } from '../utils/tools';
import { WEB_SEARCH_TOOL_SUMMARY, WEB_TOOL_SUMMARY, buildWebTools, hasWebSearch } from '../utils/web-tools';
import { WORKBENCH_TOOL_SUMMARY, buildWorkbenchTools } from '../utils/workbench-tools';
import { applyToolRegistry } from './tool-registry';

/**
 * 智能体运行时装配：把「这个人设能看见什么」从两条调用链里抽出来。
 *
 * 此前 `/api/chat` 与 `schedule-runner` 各写一遍「查绑定 → 过滤空间知识库 → 拼工作台工具 →
 * 拼工具摘要 → 解析模型」。两份代码最危险的不是重复，而是**漂移**：给聊天加了新工具或新过滤，
 * 定时任务那一轮就悄悄少一个能力，而两边都不会报错。这里只保留一份装配顺序。
 *
 * 刻意不做的事：
 * - 不建 MCP 连接。连接有生命周期（定时任务要在 `finally` 里关），由调用方接在 `toolSet` 上。
 * - 不查 RAG 内容。检索词来自「这一轮用户说了什么」，聊天与定时任务的取词方式不同。
 * - 不落会话/消息。聊天的 parts 清洗与定时任务的 user 消息形状不一样。
 */

export interface AgentCapabilities {
    /** 当前智能体可见的完整 Skill 行（已过滤 enabled） */
    skills: Skill[];
    /** 当前智能体绑定的工具行（已过滤 enabled） */
    tools: Tool[];
    /** 绑定的 MCP server id；连接由调用方建立 */
    mcpServerIds: string[];
    /** 该空间 + 全局的知识库 id；`null` 空间只取全局 */
    spaceKbIds: string[];
    /** 空间提示词上下文；独立对话为 null */
    space: { name: string; instructions: string | null; localRoot: string | null } | null;
    /** 工作台内置 + 本地文件 + 绑定工具（未合并 MCP） */
    toolSet: ToolSet;
    /** 与 `toolSet` 同源的提示词清单（未包含 MCP 服务器行） */
    toolSummary: string;
    /** 已解析的模型句柄 */
    model: Awaited<ReturnType<typeof resolveModel>>['model'];
}

export async function loadAgentCapabilities(agent: Agent, spaceId: string | null): Promise<AgentCapabilities> {
    const [boundSkills, boundTools, boundKbIds, boundMcpIds, spaceRows] = await Promise.all([
        db
            .select({ skill: skills })
            .from(agentSkills)
            .innerJoin(skills, eq(skills.id, agentSkills.skillId))
            .where(and(eq(agentSkills.agentId, agent.id), eq(skills.enabled, true))),
        db
            .select({ tool: toolsTable })
            .from(agentTools)
            .innerJoin(toolsTable, eq(toolsTable.id, agentTools.toolId))
            .where(and(eq(agentTools.agentId, agent.id), eq(toolsTable.enabled, true))),
        db
            .select({ kbId: agentKnowledgeBases.kbId })
            .from(agentKnowledgeBases)
            .where(eq(agentKnowledgeBases.agentId, agent.id))
            .then((rows) => rows.map((row) => row.kbId)),
        db
            .select({ mcpServerId: agentMcpServers.mcpServerId })
            .from(agentMcpServers)
            .where(eq(agentMcpServers.agentId, agent.id))
            .then((rows) => rows.map((row) => row.mcpServerId)),
        spaceId
            ? db.select({ name: spaces.name, instructions: spaces.instructions, localRoot: spaces.localRoot }).from(spaces).where(eq(spaces.id, spaceId))
            : Promise.resolve([]),
    ]);

    const spaceKbIds = boundKbIds.length
        ? (
              await db
                  .select({ id: knowledgeBases.id })
                  .from(knowledgeBases)
                  .where(
                      and(
                          inArray(knowledgeBases.id, boundKbIds),
                          spaceId ? or(eq(knowledgeBases.spaceId, spaceId), isNull(knowledgeBases.spaceId)) : isNull(knowledgeBases.spaceId),
                      ),
                  )
          ).map((row) => row.id)
        : [];

    const space = spaceRows[0] ?? null;
    const localTools = buildLocalFileTools(space?.localRoot || undefined);
    const commandTools = buildCommandTools();
    const webTools = buildWebTools();
    const toolSet: ToolSet = applyToolRegistry({
        ...buildWorkbenchTools(agent.id, spaceId),
        ...localTools,
        ...commandTools,
        ...webTools,
        ...buildToolSet(boundTools.map((row) => row.tool)),
    });
    const toolSummary = [
        WORKBENCH_TOOL_SUMMARY,
        ...(Object.keys(localTools).length ? [LOCAL_TOOL_SUMMARY] : []),
        ...(Object.keys(localTools).some((name) => name.startsWith('local_write') || name === 'local_edit_file' || name === 'local_mkdir')
            ? [LOCAL_WRITE_TOOL_SUMMARY]
            : []),
        ...(Object.keys(commandTools).length ? [COMMAND_TOOL_SUMMARY] : []),
        ...(Object.keys(webTools).length ? [WEB_TOOL_SUMMARY] : []),
        ...(hasWebSearch() ? [WEB_SEARCH_TOOL_SUMMARY] : []),
        ...(isCommandEnabled() ? [JOB_TOOL_SUMMARY] : []),
        SUBAGENT_TOOL_SUMMARY,
        ASSIST_TOOL_SUMMARY,
        SKILL_TOOL_SUMMARY,
        ...boundTools.map((row) => `- ${row.tool.name}（${row.tool.type === 'http' ? 'HTTP 工具' : '内置工具'}）：${row.tool.description}`),
    ].join('\n');

    const { model } = await resolveModel(agent.providerId, agent.model);

    return {
        skills: boundSkills.map((row) => row.skill),
        tools: boundTools.map((row) => row.tool),
        mcpServerIds: boundMcpIds,
        spaceKbIds,
        space,
        toolSet,
        toolSummary,
        model,
    };
}
