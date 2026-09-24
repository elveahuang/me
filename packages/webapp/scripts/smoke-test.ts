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
    // markdown-export 已迁至 commons，与下方契约测试同理用相对路径导入
    const { formatConversationMarkdown } = await import('../../commons/src/markdown-export');
    const sampleMd = formatConversationMarkdown({
        title: '测试对话',
        agentName: '架构助手',
        model: 'deepseek-r1',
        labels: {
            doc: '对话记录',
            untitled: '未命名对话',
            agent: '智能体',
            agentDefault: 'AI 智能体',
            model: '驱动模型',
            modelDefault: '默认模型',
            exportedAt: '导出时间',
            user: '用户',
            reasoning: '深度思考过程',
            attachment: '附件',
            open: '打开',
            toolCall: '工具调用',
        },
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
    assert(sampleMd.includes('> 💭 **深度思考过程**:') && sampleMd.includes('首先分析 Nuxt 4'), '包含深度思考折叠引用');
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

    // 6.1 测试套餐折扣与续费判定（契约函数，双端共用）
    // 用相对路径导入：本脚本由 tsx 直接执行，@commons 别名只在 Nuxt 构建期生效
    console.log('\n6.1 测试套餐折扣与续费判定');
    const { bestYearlyDiscountPercent, isActivePaidPlan, yearlyDiscountPercent } = await import('../../commons/src/contract/index');
    const monthlyPlan = {
        id: 'p1',
        code: 'pro',
        name: 'Pro',
        description: '',
        chatQuotaPerDay: 200,
        monthlyPriceCents: 2900,
        yearlyPriceCents: null,
        enabled: true,
        sortOrder: 1,
    };
    const yearlyPlan = { ...monthlyPlan, yearlyPriceCents: 27840 };
    const noDiscountPlan = { ...monthlyPlan, yearlyPriceCents: 34800 };
    assert(yearlyDiscountPercent(monthlyPlan) === null, '无年付价格时不显示折扣角标');
    assert(yearlyDiscountPercent(yearlyPlan) === 20, '年付折扣由真实价格算出（27840/34800 = -20%）');
    assert(yearlyDiscountPercent(noDiscountPlan) === null, '年付不低于月付 ×12 时不显示折扣');
    assert(bestYearlyDiscountPercent([monthlyPlan, yearlyPlan, noDiscountPlan]) === 20, '取套餐中最高的年付折扣');
    assert(bestYearlyDiscountPercent([monthlyPlan, noDiscountPlan]) === null, '全部无折扣时返回 null');
    assert(
        isActivePaidPlan(yearlyPlan, { plan: { ...yearlyPlan, code: 'pro' }, expiresAt: '2027-01-01T00:00:00.000Z' }) === true,
        '到期前的当前付费套餐可续费',
    );
    assert(isActivePaidPlan(yearlyPlan, { plan: yearlyPlan, expiresAt: null }) === false, '免费档不可续费（仅展示态）');
    assert(isActivePaidPlan(yearlyPlan, { plan: { ...yearlyPlan, code: 'max' }, expiresAt: '2027-01-01T00:00:00.000Z' }) === false, '非当前套餐不是续费语义');

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

    // 9. 测试入参与内容归一化纯函数（LIKE 转义、参数夹逼、链接/时间/排序/标签归一）
    console.log('\n9. 测试入参与内容归一化纯函数');
    const { likePattern, intParam } = await import('../server/utils/query');
    const { normalizeLink, normalizeSortOrder, parseDateInput, normalizeContentTags } = await import('../server/utils/content-ops');

    assert(likePattern('100%') === '%100\\%%', 'LIKE 模式转义 % 通配符');
    assert(likePattern('a_b') === '%a\\_b%', 'LIKE 模式转义 _ 通配符');
    assert(likePattern('  hi  ') === '%hi%' && likePattern('x'.repeat(500)).length === 130, '关键词先 trim 再夹到 128 字符');
    assert(
        intParam('1.7', 10, 1, 100) === 1 && intParam('-3', 10, 1, 100) === 1 && intParam('1e9', 10, 1, 100) === 100 && intParam('abc', 10, 1, 100) === 10,
        '分页参数取整、夹逼、非法值回退',
    );

    const threw400 = (fn: () => unknown): boolean => {
        try {
            fn();
            return false;
        } catch (e: any) {
            return e?.statusCode === 400;
        }
    };
    assert(
        normalizeLink('/news/1') === '/news/1' && normalizeLink('https://a.com/x') === 'https://a.com/x' && normalizeLink('') === '',
        '链接归一放行站内路径与 http(s) 绝对地址',
    );
    assert(threw400(() => normalizeLink('//evil.com')) && threw400(() => normalizeLink('javascript:alert(1)')), '链接归一拒绝协议相对与 javascript: 协议');
    assert(
        normalizeSortOrder(3.7) === 4 && normalizeSortOrder('abc', 7) === 7 && normalizeSortOrder(1e18) === 1_000_000_000,
        '排序值取整、非法回退、超界夹到安全区间',
    );
    assert(
        parseDateInput('') === null && parseDateInput('2026-01-02') instanceof Date && threw400(() => parseDateInput('not-a-date')),
        '时间入参空值放行、非法值 400',
    );
    assert(normalizeContentTags([' a ', '', 123]).join(',') === 'a,123', '标签归一去空并字符串化');

    // 10. 测试共享契约的展示层不变量（时区固定、金额、徽章/状态映射、日期边界）
    console.log('\n10. 测试共享契约展示层不变量');
    const { badgeTone, dateInputToBoundary, formatDateTime, formatDate, formatTime, formatYuan, isoToDateInput, orderStatusLabelKey, orderStatusTone } =
        await import('../../commons/src/contract/index');
    const boundaryInstant = '2026-09-24T00:30:00+08:00';
    assert(
        formatTime(boundaryInstant) === '00:30' && formatDate(boundaryInstant).endsWith('24'),
        '展示时区固定 Asia/Shanghai（主机时区为 UTC 时该时刻应显示 16:30/23 日）',
    );
    assert(formatDateTime('garbage') === '-' && formatDateTime(null) === '-', '无效时间值回退 - 而不是 Invalid Date');
    assert(formatYuan(1234) === '12.34' && formatYuan(null) === '0.00', '分转元保留两位、空值视为 0.00');
    assert(
        badgeTone('danger') === 'app-badge-danger' && badgeTone(null) === 'app-badge-neutral' && badgeTone('不存在的tone') === 'app-badge-neutral',
        '徽章 tone 映射且未知值回退 neutral',
    );
    assert(
        orderStatusTone('paid').startsWith('app-badge-') &&
            orderStatusTone('不存在') === 'app-badge-neutral' &&
            orderStatusLabelKey('不存在') === 'billing.statusClosed',
        '订单状态徽章与文案键映射、未知状态回退',
    );
    const endBoundary = dateInputToBoundary('2026-09-24', 'end');
    const startBoundary = dateInputToBoundary('2026-09-24', 'start');
    assert(
        endBoundary !== null &&
            endBoundary.getHours() === 23 &&
            endBoundary.getMinutes() === 59 &&
            endBoundary.getSeconds() === 59 &&
            endBoundary.getMilliseconds() === 999,
        '活动结束边界取当天 23:59:59.999 而不是当天零点',
    );
    assert(
        startBoundary !== null && startBoundary.getHours() === 0 && startBoundary.getMilliseconds() === 0 && dateInputToBoundary('', 'end') === null,
        '起始边界为当天零点、空值不设边界',
    );
    assert(
        isoToDateInput('bad') === '' && isoToDateInput(null) === '' && /^\d{4}-\d{2}-\d{2}$/.test(isoToDateInput('2026-09-24T15:00:00.000Z')),
        'ISO 转日期输入：无效回退空串、有效输出 YYYY-MM-DD',
    );

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
