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
    console.log('🚀 开始执行 work 本机工作台冒烟测试…\n');
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

    /** 归一函数越界时应抛出 400（而不是静默改值或回 500） */
    const threw400 = (fn: () => unknown): boolean => {
        try {
            fn();
            return false;
        } catch (e: any) {
            return e?.statusCode === 400;
        }
    };

    // 1. RAG 兜底算法：向量缺失时靠 Bigram 重叠打分
    console.log('1. 测试 Bigram 关键词检索算法');
    const { bigrams, bigramScore, chunkText } = await import('../server/utils/embedding');
    const bg1 = bigrams('你好世界');
    assert(bg1.has('你好') && bg1.has('好世') && bg1.has('世界'), '正确提取中文 Bigram 集合');

    const doc = '项目周报模板：本周里程碑、风险与下周计划';
    assert(bigramScore('周报里程碑', doc) > bigramScore('今天天气怎么样', doc) && bigramScore('周报里程碑', doc) > 0.5, '关键词重叠率精准打分');

    // 2. 知识库分块：长度与重叠量决定检索粒度
    console.log('\n2. 测试 RAG 知识库切块算法');
    const longText = '段落一：任务与日程。\n\n段落二：笔记与检索。\n\n段落三：每日简报。';
    const chunks = chunkText(longText, 30, 5);
    assert(chunks.length >= 2, '按长度与重叠量正确拆分为多个切块');
    assert(
        chunks.every((c) => c.length > 0),
        '切块内容非空且保持文本完整',
    );

    // 3. 限流器（无 Redis 时降级为进程内存）
    console.log('\n3. 测试滑动窗口限流器');
    const { rateLimit } = await import('../server/utils/rate-limit');
    const testId = `smoke_test_${Date.now()}`;
    const r1 = await rateLimit(testId, 3, 60_000);
    assert(r1.ok && r1.retryAfterSec === 0, '首次请求成功放行');
    await rateLimit(testId, 3, 60_000);
    await rateLimit(testId, 3, 60_000);
    const r4 = await rateLimit(testId, 3, 60_000);
    assert(!r4.ok && r4.retryAfterSec > 0, '达到 3 次限额后精准拦截');

    // 4. 系统提示词装配
    console.log('\n4. 测试 System Prompt 变量替换');
    const { buildSystemPrompt } = await import('../server/utils/system-prompt');
    const mockAgent: any = {
        name: '工作助手',
        systemPrompt: '你好 {{user_name}}，今天是 {{current_date}}。未知变量 {{not_a_var}} 保持原样。',
    };
    const rendered = buildSystemPrompt(mockAgent, [], '笔记检索到的片段', '工具摘要说明', { name: '本机用户' });
    assert(
        rendered.includes('本机用户') && rendered.includes('笔记检索到的片段') && rendered.includes('{{not_a_var}}') && !rendered.includes('{{current_date}}'),
        '变量注入、RAG 片段挂载成功，未知占位符不被吞掉',
    );

    // 5. 会话导出（共享契约，两端同一份序列化）
    console.log('\n5. 测试会话 Markdown 导出序列化');
    // markdown-export 在 commons 里，与下方契约测试同理用相对路径导入（@commons 别名只在 Nuxt 构建期生效）
    const { formatConversationMarkdown } = await import('../../commons/src/markdown-export');
    const sampleMd = formatConversationMarkdown({
        title: '测试对话',
        agentName: '工作助手',
        model: 'deepseek-chat',
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
            { role: 'user', parts: [{ type: 'text', text: '把这周的任务整理一下' }] },
            {
                role: 'assistant',
                parts: [
                    { type: 'reasoning', reasoning: '先按项目分组，再列到期任务' },
                    { type: 'text', text: '本周有 3 项到期。' },
                    { type: 'tool-time', toolName: 'builtin_time', output: { now: '2026-10-15 09:00' } },
                ],
            },
        ],
    });
    assert(sampleMd.includes('# 对话记录: 测试对话'), '包含标题标头');
    assert(sampleMd.includes('### 👤 用户') && sampleMd.includes('### 🤖 工作助手'), '包含双方身份标头');
    assert(sampleMd.includes('> 💭 **深度思考过程**:') && sampleMd.includes('先按项目分组'), '包含深度思考折叠引用');
    assert(sampleMd.includes('> 🛠️ **工具调用** (`builtin_time`):'), '包含工具调用结构化输出');

    // 6. 查询入参归一（分页与关键词）
    console.log('\n6. 测试查询入参归一');
    const { likePattern, intParam } = await import('../server/utils/query');
    assert(likePattern('100%') === '%100\\%%' && likePattern('a_b') === '%a\\_b%', 'LIKE 模式转义 % 与 _ 通配符');
    assert(likePattern('  hi  ') === '%hi%' && likePattern('x'.repeat(500)).length === 130, '关键词先 trim 再夹到 128 字符');
    assert(
        intParam('1.7', 10, 1, 100) === 1 && intParam('-3', 10, 1, 100) === 1 && intParam('1e9', 10, 1, 100) === 100 && intParam('abc', 10, 1, 100) === 10,
        '分页参数取整、夹逼、非法值回退（小数会被 PG 拒成 22P02 → 500 + SQL 细节外泄）',
    );

    // 7. 设置页写入归一（布尔、模型列表、工具配置与类型）
    console.log('\n7. 测试设置页入参归一');
    const { normalizeAdminBoolean } = await import('../server/utils/admin-boolean');
    const { normalizeProviderModels } = await import('../server/utils/admin-provider-input');
    const { normalizeToolConfig, normalizeToolType } = await import('../server/utils/admin-tool-input');
    assert(normalizeAdminBoolean(undefined, 'enabled', true) === true && normalizeAdminBoolean(false, 'enabled', true) === false, '缺省回退、真布尔照写');
    assert(
        threw400(() => normalizeAdminBoolean('false', 'enabled', true)),
        '字符串 "false" 拒绝而不是被 Boolean() 变成 true',
    );
    assert(normalizeProviderModels([' a ', 'a', '', 'b'], 'skip').join(',') === 'a,b', 'skip 模式只丢坏项并去重');
    assert(
        threw400(() => normalizeProviderModels([{ id: 'x' }], 'reject')),
        'reject 模式拒绝非字符串模型 id（它会一路进提示词）',
    );
    assert(
        threw400(() => normalizeToolConfig({ parameters: {} })),
        'config.parameters 非数组直接 400（执行期 for...of 会炸每个会话）',
    );
    assert(
        threw400(() => normalizeToolConfig({ headers: 'x' })),
        'config.headers 非对象直接 400',
    );
    assert(threw400(() => normalizeToolType('builtin_time ')) && threw400(() => normalizeToolType('rest')), '工具类型未知值不静默回退');

    // 8. 出站安全边界（HTTP 工具与供应商 baseUrl）
    console.log('\n8. 测试出站地址校验边界');
    const { assertAbsoluteHttpUrl, fillAndPinOrigin, isPrivateAddress } = await import('../server/utils/outbound');
    assert(
        isPrivateAddress('127.0.0.1') &&
            isPrivateAddress('0.0.0.0') &&
            isPrivateAddress('169.254.169.254') &&
            isPrivateAddress('100.64.0.1') &&
            isPrivateAddress('::1') &&
            isPrivateAddress('::ffff:10.0.0.1'),
        '回环 / 全零 / 云元数据 / CGNAT / IPv6 环回 / IPv4 映射地址都判为私网',
    );
    assert(!isPrivateAddress('8.8.8.8') && !isPrivateAddress('not-an-ip'), '公网地址与非法值不误判为私网');
    assert(assertAbsoluteHttpUrl('baseUrl', 'https://api.example.com/v1/') === 'https://api.example.com/v1', '绝对地址去尾斜杠');
    assert(
        threw400(() => assertAbsoluteHttpUrl('baseUrl', '/v1/chat')) && threw400(() => assertAbsoluteHttpUrl('baseUrl', 'javascript:alert(1)')),
        '相对路径与非 http(s) 协议拒绝',
    );
    assert(fillAndPinOrigin('https://internal.test/api/{{id}}', { id: '7' }).endsWith('/api/7'), '参数落在路径段正常填充');
    assert(
        threw400(() => fillAndPinOrigin('https://{{host}}/api', { host: 'evil.com' })),
        '参数改写主机时拒绝（origin 已锁定，SSRF 预检才不会被打空）',
    );

    // 9. 存储与附件归一（endpoint / objectKey / 文件名 / MIME / 体积 / 密钥脱敏）
    console.log('\n9. 测试存储与附件归一');
    const {
        buildObjectKey,
        isMimeAllowed,
        normalizeAttachmentCategory,
        normalizeMimeType,
        normalizeStorageEndpoint,
        relayLimitBytes,
        relayReadLimitBytes,
        sanitizeFilename,
        sanitizeStorageConfig,
    } = await import('../server/utils/storage');
    assert(normalizeStorageEndpoint('http://127.0.0.1:9000/') === 'http://127.0.0.1:9000', 'endpoint 去尾斜杠');
    assert(threw400(() => normalizeStorageEndpoint('')) && threw400(() => normalizeStorageEndpoint('ftp://h/p')), 'endpoint 必填且只允许 http(s)');
    const key = buildObjectKey({ prefix: '/uploads/' }, '../../etc/passwd', 'Image');
    assert(key.startsWith('uploads/image/') && !key.includes('..'), '对象键归一 prefix、类别小写，文件名不带走路径穿越');
    assert(sanitizeFilename('a/b\\c.pdf') === 'c.pdf' && sanitizeFilename('中文 报告.docx') === '中文 报告.docx', '文件名只取末段且保留中文名');
    assert(
        normalizeMimeType('x'.repeat(500)).length === 128 && normalizeMimeType('bad\u0000mime') === 'application/octet-stream',
        'MIME 截到 128 并拒绝控制字符',
    );
    assert(normalizeAttachmentCategory('  !!  ') === 'other', '空类别回退 other');
    assert(
        isMimeAllowed({ allowedMimeTypes: [] }, 'any/thing') &&
            isMimeAllowed({ allowedMimeTypes: ['image/'] }, 'image/png') &&
            !isMimeAllowed({ allowedMimeTypes: ['image/png'] }, 'image/jpeg'),
        'MIME 白名单：空列表放行、前缀与全等两种匹配',
    );
    assert(
        relayReadLimitBytes(1024) === relayLimitBytes(1024) + 64 * 1024 && relayLimitBytes(1024) === 64 * 1024 * 1024,
        '中转读取上限 = 配置与硬上限取小 + 协议开销余量',
    );
    const sanitized = sanitizeStorageConfig({
        id: 's1',
        name: 'minio',
        accessKeyId: 'AKIA1234567890',
        secretAccessKey: 'top-secret',
    } as any);
    assert(
        sanitized.accessKeyIdPreview === 'AKIA****' && sanitized.hasCredentials === true && !('secretAccessKey' in sanitized) && !('accessKeyId' in sanitized),
        '存储配置脱敏：只回前缀与是否有密钥，响应里没有密钥原文',
    );

    // 10. 本机来源闸门（work 唯一的跨站写防护）
    console.log('\n10. 测试本机来源闸门');
    const { blocksWrite, isLocalOrigin } = await import('../server/utils/local-origin');
    assert(isLocalOrigin(undefined) && isLocalOrigin('http://127.0.0.1:3001') && isLocalOrigin('http://localhost:5173'), '无 Origin 与回环来源放行');
    assert(
        !isLocalOrigin('https://evil.example') && !isLocalOrigin('127.0.0.1') && !isLocalOrigin('http://127.0.0.1.evil.example'),
        '外站、裸串与仿冒主机名判为外部',
    );
    assert(
        blocksWrite('POST', 'https://evil.example') && blocksWrite('DELETE', 'https://evil.example') && !blocksWrite('GET', 'https://evil.example'),
        '写方法拦、读方法不拦',
    );
    assert(!blocksWrite('POST', 'http://localhost:3001') && !blocksWrite('PATCH', undefined), '本机来源与非浏览器客户端放行');

    // 11. 工作台写入归一与北京日口径（projects/tasks/notes/events 各 handler 共用的同一套规则）
    console.log('\n11. 测试工作台写入归一与北京日口径');
    const {
        WORK_TITLE_MAX,
        normalizeWorkDate,
        normalizeWorkDateRange,
        normalizeWorkId,
        normalizeWorkOptionalText,
        normalizeWorkTags,
        normalizeWorkText,
        normalizeTaskStatus,
        taskCompletionPatch,
    } = await import('../server/utils/work-input');
    const { safeTrim, stripNull } = await import('../server/utils/pg-text');
    const { shanghaiDateInput, shanghaiDateKey, shanghaiDayRange } = await import('../server/utils/work-day');

    assert(normalizeWorkText('  写周报  ', 'title', WORK_TITLE_MAX) === '写周报', '必填文本 trim 后返回');
    assert(
        threw400(() => normalizeWorkText('   ', 'title', WORK_TITLE_MAX)) && threw400(() => normalizeWorkText(123, 'title', 10)),
        '全空白与非字符串的必填文本回 400（非字符串会被 postgres-js 拒成 500 并透出 SQL）',
    );
    assert(
        normalizeWorkOptionalText(undefined, 'detail', 10) === '' && normalizeWorkOptionalText(null, 'detail', 10) === '',
        "选填文本缺失归一成空串（列是 notNull default ''）",
    );
    assert(
        stripNull('a\u0000b') === 'ab' && normalizeWorkText('x\u0000', 'title', 5) === 'x',
        'U+0000 一律剔除（text/jsonb 列都不接受它，带进去整条 INSERT 连 SQL 一起回显）',
    );
    assert(safeTrim({ toString: () => ' x ' }) === '' && safeTrim('  y  ') === 'y', 'safeTrim 只认字符串，对象不会被 toString 蒙混过关');
    assert(
        normalizeTaskStatus(undefined) === 'todo' && threw400(() => normalizeTaskStatus('one')),
        '枚举缺失回退、未知值拒绝：静默落库的坏状态会让任务在看板与筛选里凭空消失',
    );
    assert(normalizeWorkTags(['a', 'a', '  ', 2026, {}, null, 'b']).join(',') === 'a,2026,b', '标签去重、标量字符串化、对象与空串丢弃');
    assert(
        threw400(() => normalizeWorkTags('a,b')) && threw400(() => normalizeWorkId('not-a-uuid', 'projectId')),
        'tags 非数组与 id 形状不对都回 400（省一次无谓查库）',
    );
    assert(
        threw400(() => normalizeWorkDate('2026-02-30', 'dueAt')) && threw400(() => normalizeWorkDate('2025-02-29', 'dueAt')),
        '不存在的日历日拒绝：V8 会把 02-30 顺延成 03-02，提醒与简报就静默错一天',
    );
    assert(threw400(() => normalizeWorkDate(1e18, 'dueAt')) && normalizeWorkDate('', 'dueAt') === null, '超出 1970–2100 的脏时间戳拒绝，空串归一为 null');
    const dayStart = new Date('2026-10-15T06:00:00+08:00');
    assert(
        threw400(() => normalizeWorkDateRange('2026-10-15T05:00:00+08:00', dayStart)),
        'endsAt 早于 startsAt 拒绝',
    );
    assert(
        'completedAt' in taskCompletionPatch('done', null) && !('completedAt' in taskCompletionPatch('done', new Date())),
        '置 done 补完成时间、已完成的不再重写',
    );
    assert(
        JSON.stringify(taskCompletionPatch('todo', new Date(0))) === '{"completedAt":null}',
        '退回未完成时清掉旧的完成时间（否则统计里有一条「进行中但已完成于…」）',
    );
    assert(
        shanghaiDateInput('2026-10-15')?.toISOString() === '2026-10-14T16:00:00.000Z' &&
            shanghaiDateInput('2026-10-15', 'end')?.toISOString() === '2026-10-15T15:59:59.999Z',
        '日期入参按北京日解释：起于 UTC 前一日 16:00，止于 23:59:59.999',
    );
    assert(shanghaiDateInput('2026-02-30') === null && shanghaiDateInput('tomorrow') === null, '假日期与非 YYYY-MM-DD 回退 null 而不是 Invalid Date');
    assert(
        shanghaiDayRange(new Date('2026-10-14T16:30:00Z')).start.toISOString() === '2026-10-14T16:00:00.000Z' &&
            shanghaiDateKey(new Date('2026-10-14T16:30:00Z')) === '2026-10-15',
        '「今天」的窗口与日键固定北京口径，不受主机时区影响（UTC 容器上会差一天）',
    );

    // 12. 启动环境审计（work 无鉴权，绑定地址是唯一边界）
    console.log('\n12. 测试启动环境审计');
    const { auditEnv } = await import('../server/utils/env-guard');
    assert(
        auditEnv({ NODE_ENV: 'production', POSTGRES_URL: 'postgresql://u:p@127.0.0.1:5432/work', NITRO_HOST: '127.0.0.1' }).problems.length === 0,
        '生产 + 回环绑定 + 已配库：无阻塞问题',
    );
    assert(
        auditEnv({ NODE_ENV: 'production', POSTGRES_URL: '' }).problems.some((p) => p.includes('POSTGRES_URL')),
        '缺 POSTGRES_URL 在生产直接拒绝启动（否则会静默连到 db.ts 写死的默认库）',
    );
    assert(
        auditEnv({ NODE_ENV: 'production', POSTGRES_URL: 'postgresql://u:p@127.0.0.1:5432/work', NITRO_HOST: '0.0.0.0' }).problems.some((p) =>
            p.includes('回环'),
        ),
        '非回环绑定且没有显式放行时判为 problem（nitro 的 node preset 不解析 --host，只认 NITRO_HOST/HOST）',
    );
    assert(
        auditEnv({ NODE_ENV: 'production', POSTGRES_URL: 'postgresql://u:p@127.0.0.1:5432/work', NITRO_HOST: '0.0.0.0', WORK_ALLOW_PUBLIC_BIND: 'true' })
            .problems.length === 0,
        'WORK_ALLOW_PUBLIC_BIND=true 是显式出口：降为告警而不是拒绝',
    );

    // 13. 单主数据不变量：work 的表刻意没有归属列，也不该长出商业表
    console.log('\n13. 测试单主 schema 数据不变量');
    const { getTableConfig } = await import('drizzle-orm/pg-core');
    const schema = await import('../server/db/schema');
    const columnsOf = (t: any) => getTableConfig(t).columns.map((c) => c.name);
    const primaryOf = (t: any) =>
        getTableConfig(t)
            .columns.filter((c: any) => c.primary)
            .map((c) => c.name);
    assert(!columnsOf(schema.attachments).includes('user_id') && !columnsOf(schema.conversations).includes('user_id'), '附件与会话表没有 user_id 归属列');
    assert(columnsOf(schema.messages).includes('seq'), '消息表保留全局 seq（上下文按它排序）');
    assert(primaryOf(schema.briefs).join(',') === 'brief_date', '简报以日期为主键（定时任务重复触发靠 upsert 幂等）');
    assert(
        ['orders', 'membershipPlans', 'user', 'users'].every((k) => !(k in schema)),
        'schema 里没有订单/会员/账号表（fork 时刻意不带）',
    );

    // 14. 共享契约展示层：时区固定与徽章回退
    console.log('\n14. 测试共享契约展示层不变量');
    const { badgeTone, formatDate, formatDateTime, formatTime } = await import('../../commons/src/contract/index');
    const boundaryInstant = '2026-09-24T00:30:00+08:00';
    assert(
        formatTime(boundaryInstant) === '00:30' && formatDate(boundaryInstant).endsWith('24'),
        '展示时区固定 Asia/Shanghai（主机为 UTC 时裸 toLocaleXxx 会显示 16:30/23 日）',
    );
    assert(formatDateTime('garbage') === '-' && formatDateTime(null) === '-', '无效时间值回退 - 而不是 Invalid Date');
    assert(
        badgeTone('danger') === 'app-badge-danger' && badgeTone(null) === 'app-badge-neutral' && badgeTone('不存在的tone') === 'app-badge-neutral',
        '徽章 tone 映射且未知值回退 neutral',
    );

    // 15. 数据库连通性与核心表（可选：本机未起数据库时跳过）
    console.log('\n15. 测试数据库连通性与核心数据表');
    try {
        const { sql } = await import('drizzle-orm');
        const { db } = await import('../server/utils/db');
        await db.execute(sql`SELECT 1`);
        assert(true, 'PostgreSQL 数据库连通正常');
        for (const [name, table] of [
            ['projects', schema.projects],
            ['tasks', schema.tasks],
            ['notes', schema.notes],
            ['events', schema.events],
            ['briefs', schema.briefs],
            ['agents', schema.agents],
        ] as const) {
            const [row] = await db.select({ count: sql<number>`count(*)` }).from(table);
            assert(Number(row?.count ?? 0) >= 0, `${name} 表可正常查询`);
        }
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
