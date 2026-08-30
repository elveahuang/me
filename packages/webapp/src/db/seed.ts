import { config } from 'dotenv';

config({ path: ['.env.local', '.env'] });

async function main() {
    const { db } = await import('./index');
    const { agents, agentSkills, skills, user } = await import('./schema');
    const { auth } = await import('../lib/auth');
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

    // 3. 智能体
    const agentSeeds = [
        {
            name: '通用助手',
            emoji: '🤖',
            description: '日常问答、写作、翻译样样都行的通用智能体',
            systemPrompt: '你是一个乐于助人的中文智能助手，回答准确、简洁、有条理。',
            model: 'deepseek:deepseek-chat',
            enabled: true,
            skillIdx: [0, 1],
        },
        {
            name: '数据看板助手',
            emoji: '📊',
            description: '擅长把数字整理成卡片和指标展示',
            systemPrompt: '你是一个数据分析助手，擅长把数据整理成清晰的指标卡。收到数据问题时，先给结论再用组件展示关键指标。',
            model: 'deepseek:deepseek-chat',
            enabled: true,
            skillIdx: [0],
        },
        {
            name: '文案写作助手',
            emoji: '✍️',
            description: '营销文案、标题、社媒帖子创作',
            systemPrompt: '你是一位资深文案策划，文风灵活，擅长提供多个候选方案并说明适用场景。',
            model: 'openai:gpt-4o-mini',
            enabled: true,
            skillIdx: [1],
        },
    ];

    for (const seed of agentSeeds) {
        const found = await db.select().from(agents).where(eq(agents.name, seed.name));
        if (found.length > 0) {
            console.log(`智能体已存在: ${seed.name}`);
            continue;
        }
        const { skillIdx, ...values } = seed;
        const created = (await db.insert(agents).values(values).returning())[0];
        if (!created) throw new Error(`创建智能体失败: ${seed.name}`);
        const links = skillIdx
            .map((i) => ({ agentId: created.id, skillId: skillIds[i] }))
            .filter((l): l is { agentId: number; skillId: number } => typeof l.skillId === 'number');
        if (links.length > 0) {
            await db.insert(agentSkills).values(links);
        }
        console.log(`已创建智能体: ${seed.name}`);
    }

    console.log('Seed 完成 ✅');
    process.exit(0);
}

main().catch((err) => {
    console.error('Seed 失败:', err);
    process.exit(1);
});
