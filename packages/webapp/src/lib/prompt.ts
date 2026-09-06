import type { agents, skills } from '@/db/schema';
import { catalog } from './catalog';

type Agent = typeof agents.$inferSelect;
type Skill = typeof skills.$inferSelect;

export interface UserPromptContext {
    name?: string | null;
    role?: string | null;
}

function interpolateVariables(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
        return Object.prototype.hasOwnProperty.call(vars, key) ? (vars[key] ?? '') : match;
    });
}

/**
 * 组装智能体最终系统提示词：
 * 1. 管理员在后台配置的人设/规则（支持 {{user_name}}, {{user_role}}, {{current_date}}, {{agent_name}} 模版插值）
 * 2. 当前环境与时空上下文
 * 3. 挂载的 Skill 指令
 * 4. ReAct 工具使用指引（挂载了内置/HTTP/MCP 工具时）
 * 5. RAG 检索命中的知识库参考资料
 * 6. json-render 组件目录说明（让模型能输出可渲染的 UI 规范）
 */
export function buildSystemPrompt(
    agent: Agent,
    agentSkillList: Skill[],
    knowledgeContext: string | null = null,
    toolSummary: string | null = null,
    userContext?: UserPromptContext,
) {
    const sections: string[] = [];

    const now = new Date();
    const vars: Record<string, string> = {
        user_name: userContext?.name?.trim() || '用户',
        user_role: userContext?.role?.trim() || '普通用户',
        current_date: now.toISOString().slice(0, 10),
        current_time: now.toLocaleString('zh-CN'),
        agent_name: agent.name,
    };

    if (agent.systemPrompt.trim()) {
        sections.push(interpolateVariables(agent.systemPrompt.trim(), vars));
    }

    // 注入基础时空与用户信息上下文，确保智能体知晓当前时间与对话对象身份
    const contextLines = [`- 当前日期与时间：${now.toLocaleString('zh-CN')} (UTC+8)`];
    if (userContext?.name) {
        contextLines.push(`- 当前用户昵称：${userContext.name}`);
    }
    if (userContext?.role) {
        contextLines.push(`- 当前用户角色：${userContext.role}`);
    }
    sections.push(`# 环境信息\n\n${contextLines.join('\n')}`);

    const enabledSkills = agentSkillList.filter((s) => s.enabled && s.instructions.trim());
    if (enabledSkills.length > 0) {
        sections.push(
            `# 可用技能（Skills）\n\n${enabledSkills.map((s) => `## 技能：${s.name}\n${interpolateVariables(s.instructions.trim(), vars)}`).join('\n\n')}`,
        );
    }

    if (toolSummary) {
        sections.push(
            [
                '# 工具使用（ReAct）',
                '',
                '你装备了以下工具，可在回答过程中调用：',
                '',
                toolSummary,
                '',
                '按 ReAct 循环工作：先思考需要什么信息（思考），再调用合适的工具（行动），拿到结果后继续思考或作答（观察）。',
                '能够从工具中直接获得的信息必须调用工具获取，不要凭记忆编造；调用失败时向用户说明原因，不要反复重试同一调用。',
            ].join('\n'),
        );
    }

    if (knowledgeContext) {
        sections.push(
            [
                '# 知识库参考资料',
                '',
                '以下是知识库中检索到的与用户问题相关的内容，回答时优先引用这些资料，并在引用处标注来源编号（如 [1]）。资料与问题无关时忽略：',
                '',
                knowledgeContext,
            ].join('\n'),
        );
    }

    sections.push(
        catalog.prompt({
            system: '当回答适合用结构化 UI 展示时（数据、卡片、指标、提示等），在 Markdown 回复中插入 json-render 代码块。',
            customRules: [
                '正文使用简体中文',
                'json-render 代码块中的组件只能使用上面目录里列出的组件',
                '不要把整段回答都塞进 json-render，普通解释仍用 Markdown',
            ],
        }),
    );

    return sections.join('\n\n');
}
