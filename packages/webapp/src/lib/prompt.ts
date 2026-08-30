import { catalog } from './catalog';
import type { agents, skills } from '@/db/schema';

type Agent = typeof agents.$inferSelect;
type Skill = typeof skills.$inferSelect;

/**
 * 组装智能体最终系统提示词：
 * 1. 管理员在后台配置的人设/规则
 * 2. 挂载的 Skill 指令
 * 3. json-render 组件目录说明（让模型能输出可渲染的 UI 规范）
 */
export function buildSystemPrompt(agent: Agent, agentSkillList: Skill[]) {
    const sections: string[] = [];

    if (agent.systemPrompt.trim()) {
        sections.push(agent.systemPrompt.trim());
    }

    const enabledSkills = agentSkillList.filter((s) => s.enabled && s.instructions.trim());
    if (enabledSkills.length > 0) {
        sections.push(
            `# 可用技能（Skills）\n\n${enabledSkills
                .map((s) => `## 技能：${s.name}\n${s.instructions.trim()}`)
                .join('\n\n')}`,
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
