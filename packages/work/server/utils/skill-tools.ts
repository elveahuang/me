import { tool, type ToolSet } from 'ai';
import * as zod from 'zod';
import type { Skill } from '../db/schema';

/**
 * 技能按需披露（P2-5）。
 *
 * 系统提示词只列「/技能名 + 描述」，正文由模型在真正使用前调 `skill_load` 取回；
 * 消息开头的 `/技能名` 由调用方直接注入正文（见 `skillDirectiveSection`），不依赖模型自觉。
 * 这样绑定 20 个技能时，每轮上下文不再背着 20 份正文。
 */
export const SKILL_TOOL_SUMMARY = '- skill_load：按名称读取一个已绑定技能的完整说明（只读；先用系统提示词里的技能清单判断要不要加载）';

export function enabledSkills(skillList: Skill[]): Skill[] {
    return skillList.filter((skill) => skill.enabled && skill.instructions?.trim());
}

export function matchSkillDirective(text: string, skillList: Skill[]): Skill | null {
    const matched = /^\s*\/([A-Za-z0-9_\u4e00-\u9fa5-]{1,64})(?:\s|$)/.exec(text ?? '');
    if (!matched) return null;
    const name = matched[1]?.toLowerCase();
    return enabledSkills(skillList).find((skill) => skill.name.toLowerCase() === name) ?? null;
}

export function skillDirectiveSection(skill: Skill): string {
    return `# 用户指定的技能：${skill.name}\n\n${skill.instructions.trim()}`;
}

export function buildSkillTools(skillList: Skill[]): ToolSet {
    return {
        skill_load: tool({
            description: '读取一个已绑定技能的完整说明。系统提示词只列出技能名与描述；真正按某技能做事前先调用它。',
            inputSchema: zod.object({ name: zod.string().min(1).max(64).describe('系统提示词里列出的技能名，不带斜杠') }),
            execute: async (input) => {
                const wanted = input.name.trim().replace(/^\//, '').toLowerCase();
                const skill = enabledSkills(skillList).find((entry) => entry.name.toLowerCase() === wanted);
                if (!skill) return { error: { code: 'SKILL_NOT_FOUND', message: `没有名为「${input.name}」的可用技能` } };
                return { name: skill.name, description: skill.description ?? '', instructions: skill.instructions.trim() };
            },
        }),
    } as ToolSet;
}
