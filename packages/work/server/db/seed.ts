import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 优先加载环境变量文件
for (const envPath of ['.env', '.env.local', '../../.env', '../../.env.local']) {
    const full = resolve(process.cwd(), envPath);
    if (existsSync(full)) {
        try {
            process.loadEnvFile(full);
        } catch (error) {
            // 格式损坏的 .env 被静默忽略会让人以为「变量明明设了却没生效」
            console.warn(`[seed] 加载 ${full} 失败，已忽略:`, (error as Error)?.message || error);
        }
    }
}

async function main() {
    const { eq } = await import('drizzle-orm');
    const { db } = await import('../utils/db');
    const { agentSkills, agentTools, agents, events, notes, projects, skills, systemSettings, tasks, tools } = await import('./schema');

    console.log('🌱 开始初始化 work 的 Seed 数据…');

    // 1. 系统设置（单行 id='default'）
    const [settingRow] = await db.select().from(systemSettings).where(eq(systemSettings.id, 'default'));
    if (settingRow) {
        console.log('✓ 系统设置已存在');
    } else {
        await db.insert(systemSettings).values({ id: 'default', siteTitle: 'WORK' });
        console.log('✓ 已创建系统设置');
    }

    // 2. Skills（纯指令块，挂载后注入系统提示词）
    const skillSeeds = [
        {
            name: '回答风格',
            description: '统一中文表达与结构',
            instructions: '始终使用简体中文回答。先给结论再给依据，长回答使用小标题与列表分点，避免冗长铺陈。',
            enabled: true,
        },
        {
            name: '结构化输出规范',
            description: '要求模型在适合时用 json-render 组件呈现数据',
            instructions:
                '当回答涉及数据对比、关键指标或状态提示时，优先使用 json-render 代码块（Stat / Card / Badge / Alert）呈现，普通解释仍用 Markdown。数字必须来自工具结果或用户提供的数据，不得编造。',
            enabled: true,
        },
        {
            name: '工作台行动规范',
            description: '要求助手用工具落地，而不是嘴上答应',
            instructions:
                '涉及任务、笔记、日程的增删改时，必须调用对应工作台工具完成，不允许只在回答里声称「已记下」；写入前确认标题与时间齐全，缺信息就先追问。改动完成后用一行说明落到了哪条对象上。',
            enabled: true,
        },
    ];

    const skillMap = new Map<string, string>();
    for (const seed of skillSeeds) {
        const found = await db.select().from(skills).where(eq(skills.name, seed.name));
        if (found[0]) {
            skillMap.set(seed.name, found[0].id);
            console.log(`✓ Skill 已存在: ${seed.name}`);
        } else {
            const id = randomUUID();
            await db.insert(skills).values({ ...seed, id });
            skillMap.set(seed.name, id);
            console.log(`✓ 已创建 Skill: ${seed.name}`);
        }
    }

    // 3. 内置 Tool
    const toolSeeds = [{ name: '当前时间', description: '查询当前日期与时间（UTC ISO 格式）', type: 'builtin_time', config: {}, enabled: true }];

    const toolMap = new Map<string, string>();
    for (const seed of toolSeeds) {
        const found = await db.select().from(tools).where(eq(tools.name, seed.name));
        if (found[0]) {
            toolMap.set(seed.name, found[0].id);
            console.log(`✓ Tool 已存在: ${seed.name}`);
        } else {
            const id = randomUUID();
            await db.insert(tools).values({ ...seed, id });
            toolMap.set(seed.name, id);
            console.log(`✓ 已创建 Tool: ${seed.name}`);
        }
    }

    // 4. 智能体
    const agentSeeds = [
        {
            name: '工作台助手',
            emoji: '🧭',
            description: '管理你的任务、笔记与日程，每天给一份简报',
            systemPrompt: [
                '你是这台个人工作台里的助手。除了回答问题，你还能读写用户的任务、笔记与日程，遇到「帮我记一下 / 明天提醒我 / 今天有什么」这类诉求时直接调用工具完成。',
                '不确定当前时间或日期时先查「当前时间」工具，不要凭猜测写入到期日。回答保持简短，并说清落到了哪条具体对象上。',
            ].join('\n'),
            model: 'deepseek-chat',
            providerId: null,
            temperature: 0.4,
            maxTokens: null,
            maxSteps: 8,
            selfConfig: true,
            enabled: true,
            skillNames: ['工作台行动规范', '回答风格'],
            toolNames: ['当前时间'],
        },
        {
            name: '通用助手',
            emoji: '🤖',
            description: '日常问答、写作、翻译样样都行的通用智能体',
            systemPrompt: '你是一个乐于助人的中文智能助手，回答准确、简洁、有条理。',
            model: 'deepseek-chat',
            providerId: null,
            temperature: 0.7,
            maxTokens: null,
            maxSteps: 6,
            selfConfig: true,
            enabled: true,
            skillNames: ['结构化输出规范', '回答风格'],
            toolNames: ['当前时间'],
        },
        {
            name: '笔记整理助手',
            emoji: '📝',
            description: '把零散记录整理成结构化笔记',
            systemPrompt:
                '你擅长把零散的记录、会议碎片和想法整理成结构清晰的 Markdown 笔记：先给一句话结论，再分节展开，保留原文里的关键数字与专有名词，不做无依据的补充。',
            model: 'deepseek-chat',
            providerId: null,
            temperature: 0.5,
            maxTokens: null,
            maxSteps: 6,
            selfConfig: false,
            enabled: true,
            skillNames: ['回答风格'],
            toolNames: [],
        },
    ];

    for (const seed of agentSeeds) {
        const { skillNames, toolNames, ...agentValues } = seed;
        const [found] = await db.select().from(agents).where(eq(agents.name, seed.name));
        let agentId: string;

        if (found) {
            agentId = found.id;
            await db.update(agents).set(agentValues).where(eq(agents.id, agentId));
            console.log(`✓ 已更新智能体: ${seed.name}`);
        } else {
            agentId = randomUUID();
            await db.insert(agents).values({ ...agentValues, id: agentId });
            console.log(`✓ 已创建智能体: ${seed.name}`);
        }

        for (const name of skillNames) {
            const sid = skillMap.get(name);
            if (sid) await db.insert(agentSkills).values({ agentId, skillId: sid }).onConflictDoNothing();
        }
        for (const name of toolNames) {
            const tid = toolMap.get(name);
            if (tid) await db.insert(agentTools).values({ agentId, toolId: tid }).onConflictDoNothing();
        }
    }

    // 5. 示例工作台内容：只在空库上创建，重跑不会覆盖用户真实数据
    const [existingProject] = await db.select().from(projects).limit(1);
    if (existingProject) {
        console.log('✓ 工作台已有数据，跳过示例内容');
    } else {
        const projectId = randomUUID();
        await db.insert(projects).values({ id: projectId, name: '示例项目', description: 'seed 生成的演示内容，可直接删掉', color: 'green' });

        const dayStart = new Date();
        dayStart.setHours(9, 0, 0, 0);
        const tomorrow = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
        const afternoon = new Date();
        afternoon.setHours(15, 0, 0, 0);

        await db.insert(tasks).values([
            {
                id: randomUUID(),
                projectId,
                title: '看看 Today 面板都有什么',
                detail: '今日到期与逾期任务都会汇总在这里。',
                status: 'doing',
                priority: 'high',
                dueAt: dayStart,
            },
            {
                id: randomUUID(),
                projectId,
                title: '试用快捷记录',
                detail: '在 Today 顶部输入框写一句话，助手会解析成任务 / 笔记 / 日程，确认后才落库。',
                status: 'todo',
                priority: 'medium',
                dueAt: tomorrow,
            },
            {
                id: randomUUID(),
                projectId,
                title: '让助手建一条任务',
                detail: '在右侧助手里说「明天下午三点提醒我评审方案」。',
                status: 'done',
                priority: 'low',
                dueAt: dayStart,
                completedAt: dayStart,
                source: 'ai',
            },
        ]);

        await db.insert(notes).values({
            id: randomUUID(),
            projectId,
            title: '这台工作台怎么用',
            kind: 'note',
            pinned: true,
            tags: ['指南'],
            content: [
                '# 这台工作台怎么用',
                '',
                '- **Today**：今日到期、逾期任务、当天日程与每日简报。',
                '- **任务**：按项目分组，支持优先级与到期时间。',
                '- **笔记**：Markdown 编辑，检索与摘要走同一套嵌入配置。',
                '- **日历**：月视图与当天时间线。',
                '- **助手**：右侧常驻面板，能直接读写任务、笔记与日程。',
                '',
                '配置入口都在「设置」里：模型供应商、技能、工具、MCP、知识库与存储。',
            ].join('\n'),
        });

        await db.insert(events).values({
            id: randomUUID(),
            projectId,
            title: '示例日程：今天的 15 分钟检查',
            detail: '演示数据，可删除。',
            startsAt: afternoon,
            endsAt: new Date(afternoon.getTime() + 15 * 60 * 1000),
        });

        console.log('✓ 已创建示例项目、任务、笔记与日程');
    }

    console.log('✨ work 的 Seed 初始化完成！');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌ Seed 执行失败:', err);
    process.exit(1);
});
