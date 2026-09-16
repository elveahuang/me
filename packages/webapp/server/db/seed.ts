import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 优先加载环境变量文件
for (const envPath of ['.env', '.env.local', '../../.env', '../../.env.local']) {
    const full = resolve(process.cwd(), envPath);
    if (existsSync(full)) {
        try {
            process.loadEnvFile(full);
        } catch {
            // ignore
        }
    }
}

async function main() {
    const { eq } = await import('drizzle-orm');
    const { db } = await import('../utils/db');
    const { auth } = await import('../utils/auth');
    const { agentKnowledgeBases, agentSkills, agentTools, agents, kbChunks, kbDocuments, knowledgeBases, membershipPlans, skills, tools, user } =
        await import('./schema');
    const { chunkText } = await import('../utils/embedding');

    console.log('🌱 开始初始化数据库 Seed 数据…');

    // 1. 管理员账号
    const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@example.com';
    const [existingAdmin] = await db.select().from(user).where(eq(user.email, adminEmail));
    let adminId: string;

    if (existingAdmin) {
        adminId = existingAdmin.id;
        console.log(`✓ 管理员账号已存在: ${adminEmail}`);
    } else {
        const adminPassword = process.env.ADMIN_INITIAL_PASSWORD ?? randomBytes(12).toString('base64url');
        const res = await auth.api.signUpEmail({
            body: {
                name: '系统管理员',
                email: adminEmail,
                password: adminPassword,
            },
        });
        adminId = res.user.id;
        console.log(`✓ 已成功创建管理员: ${adminEmail}`);
        if (!process.env.ADMIN_INITIAL_PASSWORD) {
            console.log(`🔑 管理员初始口令（请立即保存）: ${adminPassword}`);
        }
    }
    await db.update(user).set({ role: 'admin' }).where(eq(user.id, adminId));

    // 2. 会员套餐
    const planSeeds = [
        {
            id: crypto.randomUUID(),
            code: 'free',
            name: '免费版',
            description: '注册即用，体验平台基础智能体能力',
            chatQuotaPerDay: 20,
            monthlyPriceCents: 0,
            yearlyPriceCents: null,
            sortOrder: 0,
        },
        {
            id: crypto.randomUUID(),
            code: 'pro',
            name: '专业版',
            description: '每日 200 次对话，适合个人重度使用与高阶任务',
            chatQuotaPerDay: 200,
            monthlyPriceCents: 2900,
            yearlyPriceCents: 29000,
            sortOrder: 1,
        },
        {
            id: crypto.randomUUID(),
            code: 'max',
            name: '旗舰版',
            description: '不限对话次数，尊享专属大模型与最高并发',
            chatQuotaPerDay: null,
            monthlyPriceCents: 9900,
            yearlyPriceCents: 99000,
            sortOrder: 2,
        },
    ];

    for (const seed of planSeeds) {
        const found = await db.select().from(membershipPlans).where(eq(membershipPlans.code, seed.code));
        if (found.length > 0) {
            await db
                .update(membershipPlans)
                .set({
                    name: seed.name,
                    description: seed.description,
                    chatQuotaPerDay: seed.chatQuotaPerDay,
                    monthlyPriceCents: seed.monthlyPriceCents,
                    yearlyPriceCents: seed.yearlyPriceCents,
                    sortOrder: seed.sortOrder,
                })
                .where(eq(membershipPlans.code, seed.code));
            console.log(`✓ 已更新套餐: ${seed.name} (${seed.code})`);
        } else {
            await db.insert(membershipPlans).values(seed);
            console.log(`✓ 已创建套餐: ${seed.name} (${seed.code})`);
        }
    }

    // 3. Skills（纯指令块，挂载后注入系统提示词）
    const skillSeeds = [
        {
            name: '结构化输出规范',
            description: '要求模型在适合时用 json-render 组件呈现数据',
            instructions:
                '当回答涉及数据对比、关键指标或状态提示时，优先使用 json-render 代码块（Stat / Card / Badge / Alert）呈现，普通解释仍用 Markdown。数字必须来自工具结果或用户提供的数据，不得编造。',
            enabled: true,
        },
        {
            name: '回答风格',
            description: '统一中文表达与结构',
            instructions: '始终使用简体中文回答。先给结论再给依据，长回答使用小标题与列表分点，避免冗长铺陈。',
            enabled: true,
        },
        {
            name: '信息核实',
            description: '要求先调用工具再作答',
            instructions: '涉及实时信息（时间、外部接口数据）时必须先调用相应工具获取，不得凭记忆作答；工具失败时如实说明原因。',
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
            const id = crypto.randomUUID();
            await db.insert(skills).values({ ...seed, id });
            skillMap.set(seed.name, id);
            console.log(`✓ 已创建 Skill: ${seed.name}`);
        }
    }

    // 3.5 内置 Tool（可执行的 AI SDK 工具）
    const toolSeeds = [
        {
            name: '当前时间',
            description: '查询当前日期与时间（UTC ISO 格式）',
            type: 'builtin_time',
            config: {},
            enabled: true,
        },
    ];

    const toolMap = new Map<string, string>();
    for (const seed of toolSeeds) {
        const found = await db.select().from(tools).where(eq(tools.name, seed.name));
        if (found[0]) {
            toolMap.set(seed.name, found[0].id);
            console.log(`✓ Tool 已存在: ${seed.name}`);
        } else {
            const id = crypto.randomUUID();
            await db.insert(tools).values({ ...seed, id });
            toolMap.set(seed.name, id);
            console.log(`✓ 已创建 Tool: ${seed.name}`);
        }
    }

    // 4. 示例智能体
    const agentSeeds = [
        {
            name: '通用助手',
            emoji: '🤖',
            description: '日常问答、写作、翻译样样都行的通用智能体',
            systemPrompt: '你是一个乐于助人的中文智能助手，回答准确、简洁、有条理。可通过 {{user_name}} 称呼用户。',
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
            name: '数据看板助手',
            emoji: '📊',
            description: '擅长把数字整理成卡片和指标展示',
            systemPrompt:
                '你是一个专业的数据分析助手，擅长把业务与统计数据整理成清晰的指标卡。收到数据问题时，先给核心结论，再用 Stat / Card 组件呈现关键指标。',
            model: 'deepseek-chat',
            providerId: null,
            temperature: 0.3,
            maxTokens: null,
            maxSteps: 6,
            selfConfig: false,
            enabled: true,
            skillNames: ['结构化输出规范'],
            toolNames: [],
        },
        {
            name: '文案写作助手',
            emoji: '✍️',
            description: '营销文案、标题、社媒帖子创作',
            systemPrompt: '你是一位资深文案策划，文风生动灵活，擅长提供多个不同风格的候选方案并说明适用场景。',
            model: 'deepseek-chat',
            providerId: null,
            temperature: 0.85,
            maxTokens: null,
            maxSteps: 4,
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
            agentId = crypto.randomUUID();
            await db.insert(agents).values({ ...agentValues, id: agentId });
            console.log(`✓ 已创建智能体: ${seed.name}`);
        }

        // 绑定 Skill
        for (const name of skillNames) {
            const sid = skillMap.get(name);
            if (sid) {
                await db.insert(agentSkills).values({ agentId, skillId: sid }).onConflictDoNothing();
            }
        }

        // 绑定 Tool
        for (const name of toolNames) {
            const tid = toolMap.get(name);
            if (tid) {
                await db.insert(agentTools).values({ agentId, toolId: tid }).onConflictDoNothing();
            }
        }
    }

    // 5. 示例知识库
    const kbName = '平台使用指南';
    const [existingKb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.name, kbName));
    let guideKbId: string;

    if (existingKb) {
        guideKbId = existingKb.id;
        console.log(`✓ 知识库已存在: ${kbName}`);
    } else {
        guideKbId = crypto.randomUUID();
        await db.insert(knowledgeBases).values({
            id: guideKbId,
            name: kbName,
            description: '本平台的用法与能力说明（示例 RAG 数据）',
            embeddingModel: 'text-embedding-3-small',
        });

        const docId = crypto.randomUUID();
        const docContent = [
            'EE 平台是一个全栈 AI 智能体平台，支持网页端（Nuxt 4 + Vue 3）与移动端（Ionic 9 + Capacitor）两种入口，数据与账号全量互通。',
            '',
            '## 智能体体系',
            '智能体由管理员在后台统一创建与配置，支持设定人设提示词、Temperature、Max Tokens、Max Steps 等参数，并可自由挂载 Skills、MCP 服务器与 RAG 知识库。',
            '',
            '## 会员与计费',
            '平台支持免费版、专业版 Pro 和尊享版 Max 方案。提供每日对话限额控制、微信支付及模拟测试支付机制。',
            '',
            '## 高可用保障',
            '系统底层配备 Redis 滑动窗口限流与内存自适应兜底降级、消息防膨胀修剪以及多会话隔离。',
        ].join('\n');

        const chunks = chunkText(docContent);
        await db.insert(kbDocuments).values({
            id: docId,
            kbId: guideKbId,
            title: 'EE 智能体平台使用指南',
            content: docContent,
            chunkCount: chunks.length,
            status: 'ready',
        });

        for (const c of chunks) {
            await db.insert(kbChunks).values({
                id: crypto.randomUUID(),
                kbId: guideKbId,
                documentId: docId,
                content: c,
                embedding: [],
            });
        }
        console.log(`✓ 已创建知识库与文档: ${kbName} (${chunks.length} 块)`);
    }

    // 将知识库挂载到「通用助手」
    const [generalAgent] = await db.select().from(agents).where(eq(agents.name, '通用助手'));
    if (generalAgent) {
        await db.insert(agentKnowledgeBases).values({ agentId: generalAgent.id, kbId: guideKbId }).onConflictDoNothing();
        console.log(`✓ 已将知识库挂载至智能体: 通用助手`);
    }

    console.log('✨ 数据库 Seed 初始化完成！');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌ Seed 执行失败:', err);
    process.exit(1);
});
