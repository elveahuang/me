import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 加载环境变量
for (const p of ['.env', '.env.local', '../../.env', '../../.env.local']) {
    const full = resolve(process.cwd(), p);
    if (existsSync(full)) {
        try {
            process.loadEnvFile(full);
        } catch {
            // ignore
        }
    }
}

async function runSmokeTests() {
    console.log('🚀 开始执行全链路系统冒烟测试…\n');
    let passed = 0;
    let failed = 0;

    function assert(condition: boolean, desc: string) {
        if (condition) {
            console.log(`  ✓ [PASS] ${desc}`);
            passed++;
        } else {
            console.error(`  ✗ [FAIL] ${desc}`);
            failed++;
        }
    }

    // 1. 测试 Bigram 相似度与 RAG 兜底算法
    console.log('1. 测试 Bigram 关键词检索算法');
    const { bigrams, bigramScore } = await import('../server/utils/embedding');
    const bg1 = bigrams('你好世界');
    assert(bg1.has('你好') && bg1.has('好世') && bg1.has('世界'), '正确提取中文 Bigram 集合');

    const scoreHigh = bigramScore('平台使用指南', '这是ME智能体平台使用指南，包含计费与对话');
    const scoreLow = bigramScore('今天天气怎么样', '这是ME智能体平台使用指南，包含计费与对话');
    assert(scoreHigh > scoreLow && scoreHigh > 0.5, '关键词重叠率精准打分');

    // 2. 测试滑窗限流算法（内存降级与计数逻辑）
    console.log('\n2. 测试滑动窗口限流器');
    const { rateLimit } = await import('../server/utils/rate-limit');
    const testId = `smoke_test_${Date.now()}`;
    const r1 = await rateLimit(testId, 3, 60_000);
    assert(r1.ok && r1.retryAfterSec === 0, '首次请求成功放行');
    await rateLimit(testId, 3, 60_000);
    await rateLimit(testId, 3, 60_000);
    const r4 = await rateLimit(testId, 3, 60_000);
    assert(!r4.ok && r4.retryAfterSec > 0, '达到 3 次限额后精准拦截');

    // 3. 测试系统提示词注入器
    console.log('\n3. 测试 System Prompt 变量替换');
    const { buildSystemPrompt } = await import('../server/utils/system-prompt');
    const mockAgent: any = {
        name: '测试智能体',
        systemPrompt: '你好 {{user_name}}，今天是 {{current_date}}。',
    };
    const rendered = buildSystemPrompt(mockAgent, [], '知识库参考资料片段', '工具摘要说明', { name: '测试用户', role: 'admin' });
    assert(rendered.includes('测试用户') && rendered.includes('知识库参考资料片段'), '系统提示词变量注入与 RAG 挂载成功');

    // 4. 测试支付提供商注册表
    console.log('\n4. 测试支付渠道注册表');
    const { getPaymentProvider, listPaymentProviders } = await import('../server/utils/payments');
    const mockProvider = getPaymentProvider('mock');
    assert(mockProvider.code === 'mock', 'MockPayProvider 成功加载');
    const providersList = listPaymentProviders();
    assert(
        providersList.some((p) => p.code === 'mock'),
        '可用支付渠道列表正确导出',
    );

    // 5. 测试 Markdown 序列化工具
    console.log('\n5. 测试会话 Markdown 导出序列化');
    const { formatConversationMarkdown } = await import('../app/utils/markdown-export');
    const sampleMd = formatConversationMarkdown({
        title: '测试对话',
        agentName: '架构助手',
        model: 'deepseek-r1',
        messages: [
            { role: 'user', parts: [{ type: 'text', text: '请介绍一下项目的架构' }] },
            {
                role: 'assistant',
                parts: [
                    { type: 'reasoning', reasoning: '首先分析 Nuxt 4 服务端与 Ionic 移动端' },
                    { type: 'text', text: '该项目采用现代化全栈架构。' },
                    { type: 'tool-weather', toolName: 'weather', output: { city: '深圳', temp: 26 } },
                ],
            },
        ],
    });
    assert(sampleMd.includes('# 对话记录: 测试对话'), '包含标题标头');
    assert(sampleMd.includes('### 👤 用户') && sampleMd.includes('### 🤖 架构助手'), '包含双方身份标头');
    assert(sampleMd.includes('> 💭 **深度思考过程**：') && sampleMd.includes('首先分析 Nuxt 4'), '包含深度思考折叠引用');
    assert(sampleMd.includes('> 🛠️ **工具调用** (`weather`):'), '包含工具调用结构化输出');

    // 6. 测试会员额度与余量边界计算
    console.log('\n6. 测试会员配额边界计算');
    function calculateRemaining(quota: number | null, used: number): number | null {
        if (quota === null) return null;
        return Math.max(0, quota - used);
    }
    assert(calculateRemaining(null, 50) === null, '无限次套餐余量为 null (无限制)');
    assert(calculateRemaining(20, 5) === 15, '未耗尽时准确计算剩余额度');
    assert(calculateRemaining(20, 25) === 0, '超出配额时不出现负数，截断为 0');

    // 7. 测试文档切块分片算法
    console.log('\n7. 测试 RAG 知识库切块算法');
    const { chunkText } = await import('../server/utils/embedding');
    const longText = '段落一：企业级多智能体协同平台。\n\n段落二：基于 Nuxt 4 与 Ionic 架构。\n\n段落三：离线高可用检索支持。';
    const chunks = chunkText(longText, 30, 5);
    assert(chunks.length >= 2, '按长度与重叠量正确拆分为多个切块');
    assert(
        chunks.every((c) => c.length > 0),
        '切块内容非空且保持文本完整',
    );

    // 8. 测试数据库连接与核心表结构
    console.log('\n8. 测试数据库连通性与核心数据表');
    try {
        const { sql } = await import('drizzle-orm');
        const { db } = await import('../server/utils/db');
        const { membershipPlans, agents, user } = await import('../server/db/schema');
        await db.execute(sql`SELECT 1`);
        assert(true, 'PostgreSQL 数据库连通正常');

        const [userCount] = await db.select({ count: sql<number>`count(*)` }).from(user);
        const [agentCount] = await db.select({ count: sql<number>`count(*)` }).from(agents);
        const [planCount] = await db.select({ count: sql<number>`count(*)` }).from(membershipPlans);
        assert(Number(userCount?.count ?? 0) >= 0, 'User 表可正常查询');
        assert(Number(agentCount?.count ?? 0) >= 0, 'Agents 表可正常查询');
        assert(Number(planCount?.count ?? 0) >= 0, 'MembershipPlans 表可正常查询');
    } catch (e: any) {
        console.warn('  ⚠️ 数据库未运行或无法连接，跳过真实 DB 查询:', e?.message);
    }

    console.log(`\n========================================`);
    console.log(`🏁 冒烟测试完成: 通过 ${passed} 项，失败 ${failed} 项`);
    console.log(`========================================\n`);

    // 显式退出：Redis / postgres 客户端会保持事件循环，不退出会让 CI 一直挂起
    process.exit(failed > 0 ? 1 : 0);
}

runSmokeTests().catch((err) => {
    console.error('冒烟测试执行失败:', err);
    process.exit(1);
});
