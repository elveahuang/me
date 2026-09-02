import { config } from 'dotenv';

config({ path: ['.env.local', '.env'] });

async function main() {
    const { db } = await import('./index');
    const { agents, agentSkills, agentTools, agentKnowledge, knowledgeBases, knowledgeDocuments, skills, tools, user } = await import(
        './schema'
    );
    const { auth } = await import('../lib/auth');
    const { ingestDocument } = await import('../lib/rag');
    const { eq } = await import('drizzle-orm');

    // 1. 管理员账号
    const adminEmail = 'admin@example.com';
    const adminPassword = 'admin123456';
    const [existing] = await db.select().from(user).where(eq(user.email, adminEmail));
    let adminId: string;
    if (existing) {
        adminId = existing.id;
        console.log(`管理员已存在: ${adminEmail}`);
    } else {
        const res = await auth.api.signUpEmail({ body: { name: 'Admin', email: adminEmail, password: adminPassword } });
        adminId = res.user.id;
        console.log(`已创建管理员: ${adminEmail} / ${adminPassword}`);
    }    await db.update(user).set({ role: 'admin' }).where(eq(user.id, adminId));

    // 2. Skills
    const skillSeeds = [
        {
            name: 'UI 组件输出',
            description: '让智能体用 json-render 组件呈现结构化内容',
            instructions: [
                '在需要展示数据、指标、分组信息或重要提示时，优先输出 ```json-render 代码块，可用组件为 Card / Stat / Badge / Alert。',
                '组件块前后要有简短的 Markdown 说明文字，解释这组 UI 展示的是什么。',
                '数字类信息一律用 Stat 呈现；状态用 Badge；需要用户注意的内容用 Alert。',
            ].join('\n'),
            enabled: true,
        },
        {
            name: 'Markdown 排版',
            description: '规范回复的 Markdown 结构',
            instructions: [
                '回复使用简体中文；先给结论，再给细节。',
                '章节使用 ## 标题，列表用短句，重要术语加粗。',
                '代码示例必须带语言标注的 fenced code block。',
            ].join('\n'),
            enabled: true,
        },
    ];

    const skillIds: number[] = [];
    for (const seed of skillSeeds) {
        const found = await db.select().from(skills).where(eq(skills.name, seed.name));
        if (found[0]) {
            skillIds.push(found[0].id);
            continue;
        }
        const created = (await db.insert(skills).values(seed).returning())[0];
        if (!created) throw new Error(`创建 Skill 失败: ${seed.name}`);
        skillIds.push(created.id);
        console.log(`已创建 Skill: ${seed.name}`);
    }

    // 3. 内置 Tool 示例
    const toolSeeds = [
        {
            name: '查询当前时间',
            description: '获取服务器当前的 UTC 时间，回答时间相关问题或做时间计算前调用',
            type: 'builtin_time',
            config: {},
            enabled: true,
        },
    ];
    let timeToolId: number | null = null;
    for (const seed of toolSeeds) {
        const found = await db.select().from(tools).where(eq(tools.name, seed.name));
        if (found[0]) {
            timeToolId = found[0].id;
            continue;
        }
        const created = (await db.insert(tools).values(seed).returning())[0];
        if (!created) throw new Error(`创建 Tool 失败: ${seed.name}`);
        timeToolId = created.id;
        console.log(`已创建 Tool: ${seed.name}`);
    }

    // 4. 智能体
    const agentSeeds = [
        {
            name: '通用助手',
            emoji: '🤖',
            description: '日常问答、写作、翻译样样都行的通用智能体',
            systemPrompt: '你是一个乐于助人的中文智能助手，回答准确、简洁、有条理。',
            model: 'deepseek:deepseek-chat',
            providerId: null,
            enabled: true,
            skillIdx: [0, 1],
            withTimeTool: true,
        },
        {
            name: '数据看板助手',
            emoji: '📊',
            description: '擅长把数字整理成卡片和指标展示',
            systemPrompt: '你是一个数据分析助手，擅长把数据整理成清晰的指标卡。收到数据问题时，先给结论再用组件展示关键指标。',
            model: 'deepseek:deepseek-chat',
            providerId: null,
            enabled: true,
            skillIdx: [0],
            withTimeTool: false,
        },
        {
            name: '文案写作助手',
            emoji: '✍️',
            description: '营销文案、标题、社媒帖子创作',
            systemPrompt: '你是一位资深文案策划，文风灵活，擅长提供多个候选方案并说明适用场景。',
            model: 'openai:gpt-4o-mini',
            providerId: null,
            enabled: true,
            skillIdx: [1],
            withTimeTool: false,
        },
    ];

    for (const seed of agentSeeds) {
        const found = await db.select().from(agents).where(eq(agents.name, seed.name));
        if (found.length > 0) {
            console.log(`智能体已存在: ${seed.name}`);
            continue;
        }
        const { skillIdx, withTimeTool, ...values } = seed;
        const created = (await db.insert(agents).values(values).returning())[0];
        if (!created) throw new Error(`创建智能体失败: ${seed.name}`);
        const links = skillIdx
            .map((i) => ({ agentId: created.id, skillId: skillIds[i] }))
            .filter((l): l is { agentId: number; skillId: number } => typeof l.skillId === 'number');
        if (links.length > 0) {
            await db.insert(agentSkills).values(links);
        }
        if (withTimeTool && timeToolId !== null) {
            await db.insert(agentTools).values({ agentId: created.id, toolId: timeToolId });
        }
        console.log(`已创建智能体: ${seed.name}`);
    }

    // 4. 示例知识库（关键词检索模式，未配置 embedding 供应商）
    const guideKbName = '平台使用指南';
    let guideKbId: number | null = null;
    const existingKb = await db.select().from(knowledgeBases).where(eq(knowledgeBases.name, guideKbName));
    if (existingKb[0]) {
        guideKbId = existingKb[0].id;
        console.log('知识库已存在: 平台使用指南');
    } else {
        const kb = (await db.insert(knowledgeBases).values({ name: guideKbName, description: '本平台的用法与能力说明（示例 RAG 数据）' }).returning())[0];
        if (!kb) throw new Error('创建知识库失败');
        guideKbId = kb.id;

        const guideDoc = (await db
            .insert(knowledgeDocuments)
            .values({
                kbId: kb.id,
                title: 'ME 平台使用指南',
                content: [
                    'ME 平台是一个全栈 AI 智能体平台，支持网页端、移动端（Expo）与 Ionic/Capacitor 客户端三种入口，数据与账号互通。',
                    '',
                    '## 智能体',
                    '智能体由管理员在后台创建，配置人设（系统提示词）、模型、供应商，并可挂载 Skills、Tools、MCP 服务器与知识库。用户在对话页选择智能体即可开始对话。',
                    '',
                    '## Skills 与 Tools',
                    'Skill 是可复用的指令块，决定智能体的行为方式；Tool 是智能体可调用的工具（内置时间工具或自定义 HTTP 工具），调用遵循 ReAct 循环。',
                    '',
                    '## MCP 与知识库',
                    'MCP（Model Context Protocol）服务器提供的外部工具可直接挂载到智能体。知识库支持文档切块入库，对话时自动检索相关内容作为参考。',
                    '',
                    '## 数据说明',
                    '所有对话按会话保存，可随时切换回历史会话继续；平台对每个用户有接口频率限制以保障服务稳定。',
                ].join('\n'),
            })
            .returning())[0];
        if (!guideDoc) throw new Error('创建指南文档失败');
        const ingested = await ingestDocument({ kbId: kb.id, documentId: guideDoc.id, content: guideDoc.content });
        console.log(`已创建知识库: ${guideKbName}（${ingested.chunkCount} 块）`);
    }

    // 把示例知识库挂到通用助手
    if (guideKbId !== null) {
        const [general] = await db.select().from(agents).where(eq(agents.name, '通用助手'));
        if (general) {
            const existing = await db.select().from(agentKnowledge).where(eq(agentKnowledge.agentId, general.id));
            if (!existing.some((l) => l.kbId === guideKbId)) {
                await db.insert(agentKnowledge).values({ agentId: general.id, kbId: guideKbId });
                console.log('已挂载知识库到: 通用助手');
            }
        }
    }

    console.log('Seed 完成 ✅');
    process.exit(0);
}

main().catch((err) => {
    console.error('Seed 失败:', err);
    process.exit(1);
});
