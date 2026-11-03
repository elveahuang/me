import type { Agent, Skill } from '../db/schema';
import { catalog } from './catalog';

export interface UserPromptContext {
    name?: string | null;
    role?: string | null;
}

export interface SpacePromptContext {
    name: string;
    instructions?: string | null;
    localRoot?: string | null;
}

function interpolateVariables(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
        return Object.prototype.hasOwnProperty.call(vars, key) ? (vars[key] ?? '') : match;
    });
}

// 服务器进程时区不可信（容器多为 UTC），但提示词按“业务时钟=东八区”书写，与用户日常读写时间同一口径。
// 用固定 timeZone 格式化，避免直接 toLocaleString/toISOString 把 UTC 时间错标成 UTC+8、或跨零点给出错误日期。
const BEIJING_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const BEIJING_DATETIME = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
});

/**
 * 组装智能体最终系统提示词：
 * 1. 人设/规则（支持 {{user_name}}, {{user_role}}, {{current_date}}, {{agent_name}} 模版插值）
 * 2. 当前环境与时空上下文
 * 3. 挂载的 Skill 指令（纯提示词，不可执行）
 * 4. ReAct 工具使用指引（挂载了内置/HTTP/MCP 工具时）
 * 5. RAG 检索命中的知识库参考资料
 * 6. json-render 组件目录说明（教模型输出可渲染的 UI 代码块）
 */
export function buildSystemPrompt(
    agent: Agent,
    agentSkillList: Skill[] = [],
    knowledgeContext: string | null = null,
    toolSummary: string | null = null,
    userContext?: UserPromptContext,
    spaceContext?: SpacePromptContext | null,
): string {
    const sections: string[] = [];

    const now = new Date();
    const beijingDateTime = BEIJING_DATETIME.format(now);
    const vars: Record<string, string> = {
        user_name: userContext?.name?.trim() || '用户',
        user_role: userContext?.role?.trim() || '普通用户',
        current_date: BEIJING_DATE.format(now),
        current_time: beijingDateTime,
        agent_name: agent.name,
    };

    if (agent.systemPrompt?.trim()) {
        sections.push(interpolateVariables(agent.systemPrompt.trim(), vars));
    }

    // 注入基础时空与用户信息上下文
    const contextLines = [`- 当前日期与时间：${beijingDateTime} (UTC+8)`];
    if (userContext?.name) {
        contextLines.push(`- 当前用户昵称：${userContext.name}`);
    }
    if (userContext?.role) {
        contextLines.push(`- 当前用户角色：${userContext.role}`);
    }
    sections.push(`# 环境信息\n\n${contextLines.join('\n')}`);

    if (spaceContext?.name) {
        const lines = [`当前工作空间：${spaceContext.name}`];
        if (spaceContext.localRoot?.trim()) {
            lines.push(`当前工作空间绑定本机工作目录：${spaceContext.localRoot.trim()}（调用本地文件工具时优先在此目录内检索与读取）`);
        }
        if (spaceContext.instructions?.trim()) lines.push('', spaceContext.instructions.trim());
        sections.push(`# 工作空间\n\n${lines.join('\n')}`);
    }

    // 可用技能（只列名称与描述，正文按需由 skill_load 取回）
    const enabledSkills = agentSkillList.filter((s) => s.enabled && s.instructions?.trim());
    if (enabledSkills.length > 0) {
        sections.push(
            `# 可用技能（Skills）\n\n这里只列名称与描述，正文没有预先注入。确定要用某个技能时，先调用 skill_load(name) 取回完整说明再照做；用户消息以 /技能名 开头时，对应正文已直接注入。\n\n${enabledSkills
                .map((s) => `- /${s.name}：${(s.description ?? '').trim().slice(0, 160) || '无描述'}`)
                .join('\n')}`,
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

    sections.push(
        [
            '# 本机工作台',
            '',
            '你运行在用户自己的本机工作台里，定时任务与会话都属于他本人。',
            '- 只在用户明确要求记录、创建、修改时才调用写入类工具；拿不准就先问，不要替用户决定「这条值得记下来」。',
            '- 写入成功后在回复里说明落成了什么（标题、执行时间、挂的智能体），让用户能当场核对；失败就把原因讲清楚。',
            '- 涉及时间的表述按北京时间（UTC+8）理解与书写；「明天」「下周三」要按当前日期换算成具体日期再传给工具。',
            '- 定时任务是「到点自动跑你一轮并把结果落成一条会话」，不是提醒弹窗。用户说「提醒我」时先问清他要不要真的自动跑一轮——没有只弹提示不跑任务的那种提醒。',
        ].join('\n'),
    );

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
        }) as unknown as string,
    );

    return sections.join('\n\n');
}
