import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
// 纯类型：esbuild 会把 type-only import 整条擦掉，不会影响下面的环境变量加载顺序
import type { SchedulePlan } from '../server/utils/work-schedule';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 递归列出目录里的 `.vue` / `.ts` 源文件（冒烟测试里的静态对账用，不碰 node_modules 与生成产物）。 */
function listSourceFiles(root: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const full = resolve(root, entry.name);
        if (entry.isDirectory()) out.push(...listSourceFiles(full));
        else if (/\.(vue|ts)$/.test(entry.name)) out.push(full);
    }
    return out;
}

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
    const { bigrams, bigramScore, chunkText, fuseHybridHits } = await import('../server/utils/embedding');
    const bg1 = bigrams('你好世界');
    assert(bg1.has('你好') && bg1.has('好世') && bg1.has('世界'), '正确提取中文 Bigram 集合');

    const doc = '项目周报模板：本周里程碑、风险与下周计划';
    assert(bigramScore('周报里程碑', doc) > bigramScore('今天天气怎么样', doc) && bigramScore('周报里程碑', doc) > 0.5, '关键词重叠率精准打分');
    const hybrid = fuseHybridHits(
        [{ score: 0.5, content: 'a', documentId: 'd1', kbId: 'k1' }],
        [{ score: 0.9, content: 'b', documentId: 'd2', kbId: 'k2' }],
        2,
    );
    assert(hybrid.length === 2 && hybrid[0]!.content === 'b' && Math.abs(hybrid[0]!.score - 0.72) < 1e-9, '混合检索按权重让强关键词命中压过弱向量命中');
    const both = fuseHybridHits([{ score: 0.5, content: 'a', documentId: 'd1', kbId: 'k1' }], [{ score: 0.9, content: 'a', documentId: 'd1', kbId: 'k1' }], 5);
    assert(both.length === 1 && both[0]!.score === 1, '同一片段两路命中合并去重并封顶 1');

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

    const { getRateLimitMetrics, resetRateLimitMetrics } = await import('../server/utils/rate-limit');
    resetRateLimitMetrics();
    const metricKey = `smoke:${testId}`;
    await rateLimit(metricKey, 1, 60_000);
    await rateLimit(metricKey, 1, 60_000);
    const rateMetrics = getRateLimitMetrics();
    const metricFamily = rateMetrics.families.find((item) => item.family === 'smoke');
    assert(
        rateMetrics.calls === 2 && rateMetrics.allowed === 1 && rateMetrics.blocked === 1 && metricFamily?.calls === 2 && metricFamily.blocked === 1,
        '限流指标按 key 前缀聚合，通过/拦截各记一次且不把完整 key 当基数',
    );

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
    const withSpace = buildSystemPrompt(mockAgent, [], null, null, undefined, { name: '写作空间', instructions: '保持简洁，先给结论。' });
    assert(withSpace.includes('# 工作空间') && withSpace.includes('写作空间') && withSpace.includes('保持简洁'), '工作空间名称与长期指令注入系统提示词');

    const { partsToPlainText } = await import('../server/utils/message-text');
    assert(
        partsToPlainText([
            { type: 'text', text: '第一段' },
            { type: 'file', filename: 'a.txt' },
            { type: 'text', text: '第二段' },
        ]) === '第一段\n第二段',
        '检索列只拼 text part，忽略附件/工具结构',
    );

    const { backupChecksum } = await import('../server/utils/backup-checksum');
    const sumA = backupChecksum({ messages: [{ id: 'm1', text: 'a' }], todos: [] });
    const sumB = backupChecksum({ todos: [], messages: [{ id: 'm1', text: 'a' }] });
    const sumC = backupChecksum({ messages: [{ id: 'm1', text: 'b' }], todos: [] });
    assert(sumA === sumB && sumA !== sumC && /^[0-9a-f]{64}$/.test(sumA), '备份校验和按顶层键排序，内容变化会改变摘要');

    const previousKey = process.env.WORK_SECRET_KEY;
    process.env.WORK_SECRET_KEY = '00'.repeat(32);
    const { isSealed, openSecret, sealSecret } = await import('../server/utils/secret-box');
    const sealed = sealSecret('sk-smoke-secret');
    assert(isSealed(sealed) && sealed !== 'sk-smoke-secret' && openSecret(sealed) === 'sk-smoke-secret', 'AES-GCM 加密后再解密还原明文');
    assert(openSecret('plain-key') === 'plain-key' && sealSecret('') === '', '未加密值/空串原样透传，兼容旧数据');
    let tampered = false;
    try {
        openSecret(`${sealed.slice(0, -2)}xx`);
    } catch {
        tampered = true;
    }
    assert(tampered, '密文被篡改时 GCM 校验失败，不会返回错误明文');
    const { maskHeaders, mergeHeaders, openHeaders, sealHeaders } = await import('../server/utils/mcp');
    const sealedHeaders = sealHeaders({ Authorization: 'Bearer mcp-smoke', 'X-Trace': '' });
    assert(
        isSealed(sealedHeaders.Authorization!) &&
            sealedHeaders.Authorization !== 'Bearer mcp-smoke' &&
            openHeaders(sealedHeaders).Authorization === 'Bearer mcp-smoke',
        'MCP headers 逐项加密，建连前再解密还原',
    );
    assert(sealedHeaders['X-Trace'] === '' && openHeaders({ Authorization: 'Bearer legacy' }).Authorization === 'Bearer legacy', '空值与原明文 headers 兼容');
    assert(maskHeaders(sealedHeaders).Authorization === '****' && !JSON.stringify(maskHeaders(sealedHeaders)).includes('Bearer'), '列表掩码不泄露密文或明文');
    const kept = mergeHeaders(sealedHeaders, { Authorization: '****' });
    assert(
        kept.Authorization === sealedHeaders.Authorization && openHeaders(kept).Authorization === 'Bearer mcp-smoke',
        '编辑时回传掩码保留原密文，不把真实值覆盖成 ****',
    );
    if (previousKey === undefined) delete process.env.WORK_SECRET_KEY;
    else process.env.WORK_SECRET_KEY = previousKey;

    const { encryptLegacySecrets } = await import('../server/utils/secret-migration');
    if (!process.env.WORK_SECRET_KEY) {
        const migration = await encryptLegacySecrets();
        assert(!migration.keyConfigured && migration.total === 0, '未配置主密钥时批量加密直接返回，不写任何表');
    }

    const skillRows: any[] = [
        { id: 's1', name: 'smoke-skill', description: '冒烟技能说明', instructions: 'SECRET-BODY 技能正文', enabled: true },
        { id: 's2', name: 'off-skill', description: '未启用', instructions: '不应出现', enabled: false },
    ];
    const withSkills = buildSystemPrompt(mockAgent, skillRows, null, null);
    assert(
        withSkills.includes('/smoke-skill') && withSkills.includes('冒烟技能说明') && !withSkills.includes('SECRET-BODY') && !withSkills.includes('off-skill'),
        '技能按需披露：提示词只列名称与描述，不注入正文，也不列停用技能',
    );
    const { matchSkillDirective, skillDirectiveSection, buildSkillTools } = await import('../server/utils/skill-tools');
    assert(matchSkillDirective('/smoke-skill 帮我写', skillRows)?.name === 'smoke-skill', '/技能名 能匹配到已启用技能');
    assert(matchSkillDirective('/off-skill 帮我写', skillRows) === null, '停用技能不能被 /技能名 命中');
    assert(skillDirectiveSection(skillRows[0]!).includes('SECRET-BODY'), '显式 /技能名 会把正文注入这一轮');
    const skillTools = buildSkillTools(skillRows) as Record<string, { execute: (input: { name: string }) => Promise<any> }>;
    assert((await skillTools.skill_load!.execute({ name: 'smoke-skill' })).instructions.includes('SECRET-BODY'), 'skill_load 能按名称取回完整正文');
    assert((await skillTools.skill_load!.execute({ name: 'missing' })).error.code === 'SKILL_NOT_FOUND', 'skill_load 对未知名称返回 SKILL_NOT_FOUND');

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
    const { likePattern, intParam, stringParam } = await import('../server/utils/query');
    assert(likePattern('100%') === '%100\\%%' && likePattern('a_b') === '%a\\_b%', 'LIKE 模式转义 % 与 _ 通配符');
    assert(likePattern('  hi  ') === '%hi%' && likePattern('x'.repeat(500)).length === 130, '关键词先 trim 再夹到 128 字符');
    assert(likePattern('C:\\work\\') === '%C:\\\\work\\\\%', '反斜杠成对转义：不转义时 LIKE 的 escape 缺失会让 PG 以 22025 炸成 500');
    // 读路径的 NUL 与写路径同一个不变量：带 U+0000 的参数在驱动层就失败（0x00），
    // 而 drizzle 把整条 `Failed query: select … from "schedules" …` 连同列清单写进响应体。
    // 真实入口是查询串（`?keyword=%00bad`），不是搜索框——所以这条只能靠断言守住。
    const NUL = String.fromCharCode(0);
    assert(!likePattern(`bad${NUL}keyword`).includes(NUL), 'ILIKE 模式不留 NUL：查询串带 %00 时原本回 500 + SQL 细节外泄');
    assert(
        stringParam(`bad${NUL}keyword`) === 'badkeyword' && stringParam(['a', 'b']) === 'a',
        '查询串取单值剔 NUL 并取第一个（category / agentId 是直接进 eq() 的，同样炸）',
    );
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
        normalizeStoragePublicBaseUrl,
        relayLimitBytes,
        relayReadLimitBytes,
        sanitizeFilename,
        sanitizeStorageConfig,
    } = await import('../server/utils/storage');
    assert(normalizeStorageEndpoint('http://127.0.0.1:9000/') === 'http://127.0.0.1:9000', 'endpoint 去尾斜杠');
    assert(threw400(() => normalizeStorageEndpoint('')) && threw400(() => normalizeStorageEndpoint('ftp://h/p')), 'endpoint 必填且只允许 http(s)');
    // publicBaseUrl 会经 buildPublicUrl 写进 messages.parts 并最终渲染成 <a href>：
    // 空值合法（私有桶），但非空时必须是绝对 http(s)，否则就是一条持久的脚本/数据链接
    assert(normalizeStoragePublicBaseUrl('') === '' && normalizeStoragePublicBaseUrl(undefined) === '', 'publicBaseUrl 允许留空');
    assert(normalizeStoragePublicBaseUrl(' https://cdn.example.com/bucket/ ') === 'https://cdn.example.com/bucket', 'publicBaseUrl 去空白与尾斜杠');
    assert(
        threw400(() => normalizeStoragePublicBaseUrl('javascript:alert(1)//')) &&
            threw400(() => normalizeStoragePublicBaseUrl('data:text/html,x')) &&
            threw400(() => normalizeStoragePublicBaseUrl('cdn.example.com/bucket')),
        'publicBaseUrl 拒绝非 http(s) 与相对地址',
    );
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

    // 9.1 本地文件只读边界
    console.log('\n9.1 测试本地文件只读边界');
    const { parseLocalRoots, isPathInside, listLocalFiles, readLocalFile, searchLocalFiles } = await import('../server/utils/local-files');
    const localRoot = resolve(HERE, '..');
    const parsedRoots = parseLocalRoots(`${localRoot}; ${localRoot}`);
    assert(parsedRoots.length === 1 && parsedRoots[0] === localRoot, '本地目录白名单去重并解析为绝对路径');
    assert(isPathInside(localRoot, resolve(localRoot, 'server')) && isPathInside(localRoot, localRoot), '白名单根目录及其子路径放行');
    assert(!isPathInside(localRoot, resolve(localRoot, '..')) && !isPathInside(localRoot, resolve(localRoot, '..', 'other')), '父目录与相邻目录不会越出白名单');
    const previousRoots = process.env.WORK_FILE_ROOTS;
    process.env.WORK_FILE_ROOTS = localRoot;
    try {
        const entries = await listLocalFiles(localRoot, 1);
        assert(
            entries.some((entry) => entry.path.endsWith('package.json')),
            '白名单目录可以列出 package.json',
        );
        const packageText = await readLocalFile(resolve(localRoot, 'package.json'), 10_000);
        assert(packageText.includes('"name"'), '白名单目录可以读取文本文件');
        const hits = await searchLocalFiles('@repo/work', localRoot, 5);
        assert(hits.length > 0, '白名单目录可以按正文搜索');

        const { mkdtemp, rm } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const { editLocalFile, writeLocalFile } = await import('../server/utils/local-files');
        const tempDir = await mkdtemp(join(localRoot, '.tmp-smoke-write-'));
        process.env.WORK_FILE_WRITE = '1';
        try {
            const first = await writeLocalFile(join(tempDir, 'a.txt'), 'hello');
            assert(first.bytes === 5 && first.version.length > 0, '开启写入后可以在白名单内新建文件');
            assert((await readLocalFile(join(tempDir, 'a.txt'))) === 'hello', '写入内容可以被读回');
            let stale = false;
            try {
                await writeLocalFile(join(tempDir, 'a.txt'), 'changed', `${first.version}-wrong`);
            } catch (error) {
                stale = (error as { statusCode?: number }).statusCode === 409;
            }
            assert(stale, 'expectedVersion 不匹配时返回 409，拒绝覆盖并发修改');
            await editLocalFile(join(tempDir, 'a.txt'), 'hello', 'world', first.version);
            assert((await readLocalFile(join(tempDir, 'a.txt'))) === 'world', 'local_edit_file 按 oldText 精确替换');
        } finally {
            delete process.env.WORK_FILE_WRITE;
            await rm(tempDir, { recursive: true, force: true });
        }

        const { runControlledCommand } = await import('../server/utils/command-tools');
        process.env.WORK_COMMAND_ENABLED = '1';
        try {
            const echoed = await runControlledCommand({ command: 'echo work-command-ok', cwd: localRoot, timeoutSec: 10 });
            assert(echoed.exitCode === 0 && echoed.stdout.includes('work-command-ok'), '受控命令在 cwd 内执行并回传 stdout');
            const sleepCommand = process.platform === 'win32' ? 'ping -n 6 127.0.0.1 >nul' : 'sleep 5';
            const timed = await runControlledCommand({ command: sleepCommand, cwd: localRoot, timeoutSec: 1 });
            assert(timed.timedOut && timed.exitCode !== 0, '命令超时会杀进程并标记 timedOut');

            const { killBackgroundJob, readJobOutput, startBackgroundJob } = await import('../server/utils/jobs');
            const job = await startBackgroundJob({ command: 'echo work-job-ok', cwd: localRoot });
            let output = await readJobOutput(job.id, 0, 100);
            for (let i = 0; i < 30 && !output.done; i++) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                output = await readJobOutput(job.id, 0, 100);
            }
            assert(output.done && output.job.status === 'completed', '后台作业完成后状态落库为 completed');
            assert(
                output.chunks.some((chunk) => chunk.content.includes('work-job-ok')),
                '后台作业输出按块落库并可增量读取',
            );

            const longJob = await startBackgroundJob({ command: process.platform === 'win32' ? 'ping -n 30 127.0.0.1 >nul' : 'sleep 30', cwd: localRoot });
            assert(await killBackgroundJob(longJob.id), '运行中的后台作业可以被终止');
            assert((await readJobOutput(longJob.id, 0, 10)).job.status === 'killed', '终止后状态为 killed');

            const { db } = await import('../server/utils/db');
            const { eq } = await import('drizzle-orm');
            const { jobChunks, jobs } = await import('../server/db/schema');
            await db.delete(jobChunks).where(eq(jobChunks.jobId, job.id));
            await db.delete(jobChunks).where(eq(jobChunks.jobId, longJob.id));
            await db.delete(jobs).where(eq(jobs.id, job.id));
            await db.delete(jobs).where(eq(jobs.id, longJob.id));
        } finally {
            delete process.env.WORK_COMMAND_ENABLED;
        }

        const { fetchWebPage } = await import('../server/utils/web-tools');
        process.env.WEB_TOOL_ENABLED = '1';
        try {
            let blocked = false;
            try {
                await fetchWebPage('http://127.0.0.1:3001/api/health');
            } catch (error) {
                blocked = (error as { statusCode?: number }).statusCode === 403;
            }
            assert(blocked, 'web_fetch 拒绝 localhost/回环地址（SSRF 护栏）');
            let protocolBlocked = false;
            try {
                await fetchWebPage('file:///C:/Windows/win.ini');
            } catch (error) {
                protocolBlocked = (error as { statusCode?: number }).statusCode === 400;
            }
            assert(protocolBlocked, 'web_fetch 只接受 http/https');
        } finally {
            delete process.env.WEB_TOOL_ENABLED;
        }

        const { resolveWebSearchProvider, hasWebSearch, searchWeb, buildWebTools } = await import('../server/utils/web-tools');
        delete process.env.TAVILY_API_KEY;
        delete process.env.BRAVE_SEARCH_API_KEY;
        delete process.env.WEB_SEARCH_PROVIDER;
        process.env.WEB_TOOL_ENABLED = '1';
        try {
            assert(!hasWebSearch() && resolveWebSearchProvider() === null, '没有搜索 key 时不注入 web_search');
            let notConfigured = false;
            try {
                await searchWeb('test');
            } catch (error) {
                notConfigured = (error as { statusCode?: number }).statusCode === 501;
            }
            assert(notConfigured, '没有搜索供应商时 searchWeb 返回 501 而不是空结果');
            process.env.TAVILY_API_KEY = 'tvly-smoke';
            assert(resolveWebSearchProvider()?.provider === 'tavily' && hasWebSearch(), '只有 TAVILY_API_KEY 时自动选择 tavily');
            assert('web_search' in (buildWebTools() as Record<string, unknown>), '配置搜索 key 后注入 web_search');
            process.env.BRAVE_SEARCH_API_KEY = 'brave-smoke';
            process.env.WEB_SEARCH_PROVIDER = 'brave';
            assert(resolveWebSearchProvider()?.provider === 'brave', 'WEB_SEARCH_PROVIDER 可显式指定供应商');
        } finally {
            delete process.env.WEB_TOOL_ENABLED;
            delete process.env.TAVILY_API_KEY;
            delete process.env.BRAVE_SEARCH_API_KEY;
            delete process.env.WEB_SEARCH_PROVIDER;
        }

        const { normalizeTodoItems, createGoal, updateGoal, continueGoal, writeTodoState, readTodoState, getGoal } =
            await import('../server/utils/session-assist');
        const { db } = await import('../server/utils/db');
        const normalized = normalizeTodoItems([
            { title: '  一  ', status: 'in_progress' },
            { title: '二', status: 'done' },
        ]);
        assert(normalized.length === 2 && normalized[0]?.title === '一' && normalized[0]?.status === 'in_progress', '待办归一化保留合法状态并 trim');
        assert(normalized[1]?.status === 'pending' && normalized[0]?.id !== normalized[1]?.id, '未知状态回落 pending，缺省 id 自动生成');

        const { agents, conversations, goals, todos } = await import('../server/db/schema');
        const [agentRow] = await db.select({ id: agents.id }).from(agents).limit(1);
        if (agentRow) {
            const conversationId = `smoke-assist-${Date.now()}`;
            await db.insert(conversations).values({ id: conversationId, agentId: agentRow.id, title: 'smoke-assist' });
            try {
                await writeTodoState(conversationId, [{ title: '验证待办', status: 'pending' }]);
                const todoState = await readTodoState(conversationId);
                assert(todoState.items.length === 1 && todoState.items[0]?.title === '验证待办', 'todo_write 整表替换并可按会话读回');

                const created = await createGoal(conversationId, '完成 P2-7 的验收', 5);
                assert(created.revision === 1 && created.round === 0 && created.status === 'active', '目标创建后 revision=1/round=0');
                let conflict = false;
                try {
                    await updateGoal(conversationId, { status: 'paused', expectedRevision: 999 });
                } catch (error) {
                    conflict = (error as { statusCode?: number }).statusCode === 409;
                }
                assert(conflict, '目标 revision 冲突返回 409');
                const updated = await updateGoal(conversationId, { status: 'paused', expectedRevision: 1 });
                assert(updated.status === 'paused' && updated.revision === 2, '带正确 revision 的目标更新成功并递增');
                const continued = await continueGoal(conversationId);
                assert(continued.round === 1 && continued.status === 'active' && continued.revision === 3, '继续目标只推进 round 并恢复 active');
                assert((await getGoal(conversationId))?.round === 1, '目标推进后可按会话读回');
            } finally {
                const { eq } = await import('drizzle-orm');
                await db.delete(todos).where(eq(todos.conversationId, conversationId));
                await db.delete(goals).where(eq(goals.conversationId, conversationId));
                await db.delete(conversations).where(eq(conversations.id, conversationId));
            }
        } else {
            console.log('⚠️  没有智能体，跳过待办/目标数据库断言');
        }

        const { parseSkillMarkdown, syncSkillsFromFiles } = await import('../server/utils/skill-files');
        const parsed = parseSkillMarkdown('---\nname: smoke-skill\ndescription: 冒烟技能\n---\n# 标题\n正文', 'fallback');
        assert(
            parsed.name === 'smoke-skill' && parsed.description === '冒烟技能' && parsed.instructions.includes('正文'),
            'SKILL.md frontmatter 解析 name/description/正文',
        );
        const { writeFile } = await import('node:fs/promises');
        const { skills } = await import('../server/db/schema');
        const skillDir = await mkdtemp(join(localRoot, '.tmp-smoke-skill-'));
        await writeFile(join(skillDir, 'SKILL.md'), '---\nname: smoke-skill\ndescription: 冒烟技能\n---\n# 规则\n只做测试', 'utf8');
        process.env.WORK_SKILL_ROOTS = skillDir;
        try {
            const firstSync = await syncSkillsFromFiles();
            assert(firstSync.created === 1 && firstSync.scanned === 1, '从 WORK_SKILL_ROOTS 扫描并导入 Markdown 技能');
            const secondSync = await syncSkillsFromFiles();
            assert(secondSync.created === 0 && secondSync.updated === 0, '重复同步技能是幂等的');
        } finally {
            delete process.env.WORK_SKILL_ROOTS;
            const { eq } = await import('drizzle-orm');
            await db.delete(skills).where(eq(skills.name, 'smoke-skill'));
            await rm(skillDir, { recursive: true, force: true });
        }
    } finally {
        if (previousRoots === undefined) delete process.env.WORK_FILE_ROOTS;
        else process.env.WORK_FILE_ROOTS = previousRoots;
    }

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

    // 11. 工作台写入归一与北京日口径（定时任务的写入与「今天」的算法共用同一套规则）
    console.log('\n11. 测试工作台写入归一与北京日口径');
    const { WORK_TITLE_MAX, normalizeWorkDate, normalizeWorkId, normalizeWorkText } = await import('../server/utils/work-input');
    const { normalizeRouteId } = await import('../server/utils/route-id');
    const { safeTrim, stripNull } = await import('../server/utils/pg-text');
    const { shanghaiDateKey, shanghaiDayRange } = await import('../server/utils/work-day');

    assert(normalizeWorkText('  写周报  ', 'title', WORK_TITLE_MAX) === '写周报', '必填文本 trim 后返回');
    assert(
        threw400(() => normalizeWorkText('   ', 'title', WORK_TITLE_MAX)) && threw400(() => normalizeWorkText(123, 'title', 10)),
        '全空白与非字符串的必填文本回 400（非字符串会被 postgres-js 拒成 500 并透出 SQL）',
    );
    assert(
        stripNull('a\u0000b') === 'ab' && normalizeWorkText('x\u0000', 'title', 5) === 'x',
        'U+0000 一律剔除（text/jsonb 列都不接受它，带进去整条 INSERT 连 SQL 一起回显）',
    );
    assert(safeTrim({ toString: () => ' x ' }) === '' && safeTrim('  y  ') === 'y', 'safeTrim 只认字符串，对象不会被 toString 蒙混过关');
    assert(
        threw400(() => normalizeWorkId('not-a-uuid', 'agentId')),
        'id 形状不对回 400（省一次无谓查库）',
    );
    assert(
        normalizeRouteId('default', '工作空间', ['default']) === 'default' &&
            normalizeRouteId('123e4567-e89b-12d3-a456-426614174000', '工作空间') === '123e4567-e89b-12d3-a456-426614174000' &&
            threw400(() => normalizeRouteId('default', '工作空间')),
        '空间路径允许默认空间字面量，但其他非 UUID 仍回 400',
    );
    assert(
        threw400(() => normalizeWorkDate('2026-02-30', 'startsAt')) && threw400(() => normalizeWorkDate('2025-02-29', 'startsAt')),
        '不存在的日历日拒绝：V8 会把 02-30 顺延成 03-02，下一次运行时刻就静默错一天',
    );
    assert(
        threw400(() => normalizeWorkDate(1e18, 'startsAt')) && normalizeWorkDate('', 'startsAt') === null,
        '超出 1970–2100 的脏时间戳拒绝，空串归一为 null（1e18 读回给模型是「距今约 3000 万年」）',
    );
    assert(
        shanghaiDayRange(new Date('2026-10-14T16:30:00Z')).start.toISOString() === '2026-10-14T16:00:00.000Z' &&
            shanghaiDateKey(new Date('2026-10-14T16:30:00Z')) === '2026-10-15',
        '「今天」的窗口与日键固定北京口径，不受主机时区影响（UTC 容器上会差一天）',
    );

    // 定时任务的排期口径：这些形状在真实接口上都要等下一分钟才看得出算错，所以先在这里断言纯函数
    const {
        INTERVAL_DEFAULT_MINUTES,
        INTERVAL_MINUTES_MAX,
        INTERVAL_MINUTES_MIN,
        computeNextRunAt,
        describeSchedule,
        normalizeScheduleDays,
        normalizeScheduleInterval,
        normalizeScheduleKind,
        normalizeSchedulePlan,
        normalizeScheduleTime,
    } = await import('../server/utils/work-schedule');

    assert(
        normalizeScheduleKind(undefined) === 'daily' && threw400(() => normalizeScheduleKind('hourly')),
        '排期类型未知值拒绝：落库成 hourlv 之后列表按 kind 分组时这一条永远排不出来',
    );
    assert(
        normalizeScheduleTime('') === '' && normalizeScheduleTime('  09:00 ') === '09:00',
        '空钟点归一成空串（interval 与 once 没有钟点），带空白的合法值 trim',
    );
    assert(
        threw400(() => normalizeScheduleTime('9:00')) && threw400(() => normalizeScheduleTime('24:00')) && threw400(() => normalizeScheduleTime(900)),
        '不做「9 补成 09:00」的宽容解析：库里留下没校验过的写法，下一次 PATCH 就把用户自己填的值判成非法',
    );
    assert(
        normalizeScheduleInterval(undefined) === INTERVAL_DEFAULT_MINUTES && normalizeScheduleInterval(INTERVAL_MINUTES_MIN) === INTERVAL_MINUTES_MIN,
        '缺失间隔回退默认值、下限可取',
    );
    assert(
        threw400(() => normalizeScheduleInterval('60')) &&
            threw400(() => normalizeScheduleInterval(60.5)) &&
            threw400(() => normalizeScheduleInterval(INTERVAL_MINUTES_MIN - 1)) &&
            threw400(() => normalizeScheduleInterval(INTERVAL_MINUTES_MAX + 1)),
        '间隔只收整数分钟并夹到 5–10080：runner 每分钟醒一次，比这更密就是排队跑真实外呼（一天 1440 次）',
    );
    assert(
        normalizeScheduleDays([3, 3, 1, '5', null, 7, -1]).join(',') === '1,3' && normalizeScheduleDays(undefined).length === 0,
        '星期去重排序、非法项只丢单项（字符串不会被当成数字，7/-1 越界丢弃）',
    );
    assert(
        threw400(() => normalizeScheduleDays('0,1')),
        'days 非数组回 400（jsonb 列收下字符串后每周排期永远匹配不上任何星期）',
    );
    assert(
        threw400(() => normalizeSchedulePlan({ kind: 'weekly', time: '09:00', intervalMinutes: null, days: [], startsAt: new Date(0) })) &&
            threw400(() => normalizeSchedulePlan({ kind: 'daily', time: '', intervalMinutes: null, days: [], startsAt: new Date(0) })),
        '必填校验按 kind 分派：weekly 要有星期、daily/weekly 要有钟点',
    );
    const intervalPlan = normalizeSchedulePlan({ kind: 'interval', time: '09:00', intervalMinutes: 30, days: [1], startsAt: new Date(0) });
    assert(intervalPlan.timeText === '' && intervalPlan.days.length === 0, 'interval 丢掉钟点与星期：表单里残留的上一轮选择不会被当成排期的一部分');

    // 排期落库的是绝对时刻 `nextRunAt`，croner 只负责多久醒一次——所以下面这些日期算术必须与进程时区无关
    const dailyEarly = { kind: 'daily', timeText: '09:00', intervalMinutes: null, days: [], startsAt: new Date('2026-01-01T00:00:00+08:00') } as SchedulePlan;
    const dailyLate = { kind: 'daily', timeText: '23:30', intervalMinutes: null, days: [], startsAt: new Date('2026-01-01T00:00:00+08:00') } as SchedulePlan;
    assert(
        computeNextRunAt(dailyEarly, new Date('2026-10-15T08:00:00+08:00'))?.toISOString() === '2026-10-15T01:00:00.000Z' &&
            computeNextRunAt(dailyEarly, new Date('2026-10-15T10:00:00+08:00'))?.toISOString() === '2026-10-16T01:00:00.000Z',
        '钟点没过排今天 09:00(+08)=01:00Z，过了就排明天：runner 比较的是绝对时刻，主机时区不参与',
    );
    assert(
        computeNextRunAt(dailyEarly, new Date('2026-10-31T23:00:00+08:00'))?.toISOString() === '2026-11-01T01:00:00.000Z' &&
            computeNextRunAt(dailyEarly, new Date('2026-12-31T23:30:00+08:00'))?.toISOString() === '2027-01-01T01:00:00.000Z',
        '跨月与跨年靠 Date.UTC 的日溢出数格子，不是「减 24 小时」：后者在 23:30 排 09:00 这种边界上会把日期算成后一天',
    );
    assert(
        computeNextRunAt(dailyEarly, new Date('2028-02-28T10:00:00+08:00'))?.toISOString() === '2028-02-29T01:00:00.000Z' &&
            computeNextRunAt(dailyLate, new Date('2026-02-28T00:00:00+08:00'))?.toISOString() === '2026-02-28T15:30:00.000Z',
        '闰年 2 月 29 日排得出来；非闰年 2026-02-28 当晚 23:30 仍是当天（V8 顺延出的 03-01 会多跑一天）',
    );

    // 2026-01-04 是星期日（`makeWeekdayName` 也锚在这一天）
    const weeklyPlan = (days: number[]): SchedulePlan => ({
        kind: 'weekly',
        timeText: '09:00',
        intervalMinutes: null,
        days,
        startsAt: new Date('2026-01-01T00:00:00+08:00'),
    });
    assert(
        computeNextRunAt(weeklyPlan([0]), new Date('2026-01-03T12:00:00+08:00'))?.toISOString() === '2026-01-04T01:00:00.000Z' &&
            computeNextRunAt(weeklyPlan([1]), new Date('2026-01-03T12:00:00+08:00'))?.toISOString() === '2026-01-05T01:00:00.000Z' &&
            computeNextRunAt(weeklyPlan([0]), new Date('2026-01-04T10:00:00+08:00'))?.toISOString() === '2026-01-11T01:00:00.000Z',
        '每周只落在选中的星期上，且当天钟点已过要跳到下周同一星期（星期口径按北京日取，不是 UTC 日）',
    );

    const intervalStart = new Date('2026-01-04T09:00:00+08:00');
    const interval60 = (at: Date): SchedulePlan => ({ kind: 'interval', timeText: '', intervalMinutes: 60, days: [], startsAt: at });
    assert(
        computeNextRunAt(interval60(intervalStart), new Date('2026-01-04T00:00:00Z'))?.toISOString() === intervalStart.toISOString(),
        '还没到锚点就等锚点，不提前跑',
    );
    assert(
        computeNextRunAt(interval60(intervalStart), new Date(intervalStart.getTime() + 30_000))?.toISOString() === '2026-01-04T02:00:00.000Z' &&
            computeNextRunAt(interval60(intervalStart), new Date(intervalStart.getTime() + 3_690_000))?.toISOString() === '2026-01-04T03:00:00.000Z',
        '第 k 个整步从锚点起算：每 60 分钟永远落在整点，不会因为上一轮晚了 90 秒而一路漂下去',
    );

    const oncePlan = (at: Date): SchedulePlan => ({ kind: 'once', timeText: '', intervalMinutes: null, days: [], startsAt: at });
    assert(
        computeNextRunAt(oncePlan(new Date('2026-10-20T09:00:00+08:00')), new Date('2026-10-15T00:00:00+08:00'))?.toISOString() ===
            '2026-10-20T01:00:00.000Z' && computeNextRunAt(oncePlan(new Date('2026-10-01T09:00:00+08:00')), new Date('2026-10-15T00:00:00+08:00')) === null,
        'once 到点前给出那一刻、跑过之后回 null（runner 据此自动停用，否则一条过期排期会被反复排队）',
    );
    assert(computeNextRunAt({ ...dailyEarly, timeText: '不是钟点' }, new Date()) === null, '钟点算不出候选时回 null 而不是抛错或返回 Invalid Date');

    assert(
        describeSchedule(dailyEarly) === '每天 09:00' &&
            describeSchedule({ ...interval60(intervalStart), intervalMinutes: 30 }) === '每 30 分钟' &&
            describeSchedule(weeklyPlan([0, 1])) === '每周日、一 09:00' &&
            describeSchedule(oncePlan(new Date('2026-01-04T09:00:00+08:00'))) === '一次 2026-01-04 09:00',
        '一句句话术四种类型全覆盖：once 必须带上日期与时分，工具结果里只写「一次」等于没告诉模型是哪一天',
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
    assert(
        ['orders', 'membershipPlans', 'user', 'users'].every((k) => !(k in schema)),
        'schema 里没有订单/会员/账号表（fork 时刻意不带）',
    );
    // 待办、项目、日程三条链路已整机移除：表留在库里等于给旧深链留一个「页面没了但接口还通」的半成品
    assert(
        ['projects', 'tasks', 'events'].every((k) => !(k in schema)),
        'schema 里没有 projects/tasks/events 表（含引用它们的项目、日历与提醒代码一并删净）',
    );
    assert(
        ['agent_id', 'kind', 'time_text', 'interval_minutes', 'days', 'starts_at', 'enabled', 'next_run_at'].every((c) =>
            columnsOf(schema.schedules).includes(c),
        ),
        '定时任务表带齐排期字段与下一次时刻（croner 只负责唤醒，「什么时候跑」的真相在库里）',
    );
    assert(!columnsOf(schema.schedules).includes('user_id'), '定时任务表没有归属列（本机单主）');
    assert(primaryOf(schema.schedules).join(',') === 'id', '定时任务以 id 为主键');

    /**
     * 整机备份必须覆盖每一张表：`/api/export` 漏一张不会报错，只会静默少一份数据，
     * 而用户是按「这是这台机器的备份」来相信它的（AGENTS 里点名过的坑）。
     * 所以这条不变量按 schema 里的真实表清单来对，新增表时不补 builder 就直接测红。
     */
    const { is } = await import('drizzle-orm');
    const { PgTable } = await import('drizzle-orm/pg-core');
    const schemaTables = Object.entries(schema)
        .filter(([, value]) => is(value, PgTable))
        .map(([key]) => key)
        .sort();
    const exportText = readFileSync(resolve(HERE, '../server/utils/backup-builders.ts'), 'utf8');
    const builtTables = new Set([...exportText.matchAll(/\.from\(\s*([A-Za-z]+)\s*\)/g)].map((matched) => matched[1]!));
    // 刻意不进备份的派生数据：知识库分块与向量可重建（导入后「重建索引」），文件里也丢掉了
    const SKIPPED_TABLES = new Set(['kbChunks']);
    const uncovered = schemaTables.filter((name) => !builtTables.has(name) && !SKIPPED_TABLES.has(name));
    assert(
        schemaTables.length >= 17 && uncovered.length === 0,
        `export 覆盖 schema 的全部 ${schemaTables.length} 张表（未覆盖：${uncovered.join(', ') || '无'}；派生数据除外）`,
    );
    const ndjsonText = readFileSync(resolve(HERE, '../server/api/export/ndjson.get.ts'), 'utf8');
    assert(ndjsonText.includes('backupBuilders') && ndjsonText.includes('sendStream'), 'NDJSON 导出复用同一份表清单并流式发送');
    const { backupBuilders, backupTables } = await import('../server/utils/backup-builders');
    assert(
        Object.keys(backupBuilders).sort().join(',') === Object.keys(backupTables).sort().join(','),
        'NDJSON 分页表映射与整表 builder 键一一对应（新增表时两处都要补）',
    );
    const { parseNdjsonBackup } = await import('../server/utils/backup-import-ndjson');
    const { createHash } = await import('node:crypto');
    const ndjsonRow = { type: 'row', table: 'spaces', row: { id: 'smoke-kb', name: 'smoke' } };
    const ndjsonRowLine = `${JSON.stringify(ndjsonRow)}\n`;
    const ndjsonChecksum = createHash('sha256').update(ndjsonRowLine).digest('hex');
    const ndjsonLines = (mode = 'all', checksum = ndjsonChecksum) =>
        [
            JSON.stringify({ type: 'meta', format: 'work.backup.ndjson', version: 1, backupVersion: 5, mode }),
            JSON.stringify({ type: 'table', table: 'spaces' }),
            JSON.stringify(ndjsonRow),
            JSON.stringify({ type: 'tableEnd', table: 'spaces', count: 1 }),
            JSON.stringify({ type: 'end', checksum }),
        ].join('\n') + '\n';
    const parsedNdjson = parseNdjsonBackup(ndjsonLines());
    assert(
        parsedNdjson.tables === 1 &&
            parsedNdjson.rows === 1 &&
            (parsedNdjson.payload.data as any).spaces[0].id === 'smoke-kb' &&
            parsedNdjson.payload.format === 'work.backup',
        'NDJSON 重组为 JSON 备份形状：表/行计数正确，可直接复用单事务导入',
    );
    const ndjsonRejects = (text: string): boolean => {
        try {
            parseNdjsonBackup(text);
            return false;
        } catch (error) {
            return (error as { statusCode?: number }).statusCode === 400;
        }
    };
    assert(
        ndjsonRejects(ndjsonLines().replace(/\{"type":"end"[^\n]*\n/, '')) &&
            ndjsonRejects(ndjsonLines('all', '0'.repeat(64))) &&
            ndjsonRejects(ndjsonLines('table')),
        'NDJSON 截断、校验和不符、单表分片三种输入都拒绝，不会静默导入半份备份',
    );
    /*
     * 覆盖之外还要对「脱敏口径」：备份文件是这台机器唯一会被拷走的东西，
     * 而凭据并不只住在 providers.api_key 一列里——MCP 的鉴权是 mcp_servers.headers，
     * HTTP 工具的凭据钉在 tools.config.headers。读接口两处都打码，导出曾经只折掉前两列，
     * 于是「随手拷一份备份发给别人」会把活的 bearer token 一起带出去。
     * 断言按源码形状来（这一节跑在 tsx 里，碰不到 Nitro 的 defineEventHandler），
     * 新增藏凭据的列时把名字补进 REDACTED 并在这里加一条。
     */
    assert(
        exportText.includes('dropHeaderValues(config.headers)') && exportText.includes('dropHeaderValues(row.headers)'),
        'export 折掉 mcp_servers.headers 与 tools.config.headers（只留头名，值不进备份）',
    );
    assert(
        ["'providers.api_key'", "'storage_configs.secret_access_key'", "'mcp_servers.headers'", "'tools.config.headers'"].every((field) =>
            exportText.includes(field),
        ),
        'export 的 redacted 清单说全了四处凭据位（漏一处，用户以为备份可直接还原）',
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

    // 15. AI 工具桥口径（注册的工具与注入系统提示词的清单同源）
    console.log('\n15. 测试工作台工具桥一致性');

    const { WORKBENCH_TOOL_SUMMARY, buildWorkbenchTools } = await import('../server/utils/workbench-tools');
    const workbenchTools = buildWorkbenchTools('00000000-0000-4000-8000-000000000000');
    const toolNames = Object.keys(workbenchTools).sort();
    assert(
        toolNames.join(',') ===
            [
                'work_create_schedule',
                'work_list_runs',
                'work_list_schedules',
                'work_save_knowledge',
                'work_search',
                'work_today',
                'work_update_schedule',
                'work_update_space_memory',
            ].join(','),
        '八个工作台动作全部注册为模型可见工具，且没有多出的未声明动作',
    );
    assert(
        toolNames.every((name) => WORKBENCH_TOOL_SUMMARY.includes(name)),
        '系统提示词的工具清单与真实工具同名：提示里写一个不存在的工具，模型每轮都会空跑一次失败调用',
    );
    assert(
        Object.values(workbenchTools).every((item: any) => typeof item.description === 'string' && item.description.length > 10 && item.inputSchema),
        '每个工具都带描述与入参 schema（缺描述时模型只会瞎猜参数）',
    );
    const { isTextLikeAttachment } = await import('../server/utils/kb-ingest');
    assert(
        isTextLikeAttachment('notes.md', 'application/octet-stream') &&
            isTextLikeAttachment('data.bin', 'text/plain; charset=utf-8') &&
            !isTextLikeAttachment('photo.png', 'image/png'),
        'isTextLikeAttachment 准确识别文本/代码附件与非文本图片',
    );

    // 16. locales 对齐（zh/en 键集合、空值、插值名）——一次性探针的常驻版
    console.log('\n16. 测试两端 locales 对齐');
    const flattenLocale = (obj: unknown, prefix = ''): [string, unknown][] =>
        Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
            value && typeof value === 'object' ? flattenLocale(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]],
        );
    const { default: zhLocale } = await import('../app/locales/zh-CN');
    const { default: enLocale } = await import('../app/locales/en-US');
    const zhEntries = flattenLocale(zhLocale);
    const enEntries = flattenLocale(enLocale);
    const zhKeys = zhEntries.map((entry) => entry[0]).sort();
    const enKeys = new Set(enEntries.map((entry) => entry[0]));
    const onlyZh = zhKeys.filter((key) => !enKeys.has(key));
    const onlyEn = [...enKeys].filter((key) => !new Set(zhKeys).has(key)).sort();
    assert(onlyZh.length === 0 && onlyEn.length === 0, `zh/en 键集合一致（zh 独有 ${onlyZh.join(', ') || '无'}、en 独有 ${onlyEn.join(', ') || '无'}）`);
    assert(
        [...zhEntries, ...enEntries].every(([, value]) => typeof value === 'string' && value.trim() !== ''),
        '没有空文案键（空串会在界面上渲染成空白，比缺键更难发现）',
    );
    const placeholdersOf = (entries: [string, unknown][]) =>
        new Map(
            entries.map(([key, value]) => [
                key,
                String(value)
                    .match(/\{[A-Za-z_][A-Za-z0-9_]*\}/g)
                    ?.sort()
                    .join(',') ?? '',
            ]),
        );
    const zhPlaceholders = placeholdersOf(zhEntries);
    const enPlaceholders = placeholdersOf(enEntries);
    const placeholderDiff = [...zhKeys].filter((key) => zhPlaceholders.get(key) !== enPlaceholders.get(key));
    assert(
        placeholderDiff.length === 0,
        `同名键的插值参数成对一致（不一致时切换语言会在界面上露出裸 {n}）：${placeholderDiff.slice(0, 3).join(', ') || '无差异'}`,
    );

    /**
     * 引用侧对账：模板里写了 locales 没有的键，界面会把键名本身渲染出来（`work.foo`）。
     *
     * 上面三条只保证 zh/en 互相比对一致，两边一起缺同一个键时全绿。
     * 动态键（`t(\`work.${x}\`)`）匹配不到字面量，天然不参与判定。
     */
    const localeKeyRe = /(^|[^A-Za-z0-9_$.])t\(\s*'([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)'/g;
    const templateKeys = new Set<string>();
    for (const file of listSourceFiles(resolve(HERE, '../app'))) {
        if (file.includes(`${sep}locales${sep}`)) continue;
        for (const match of readFileSync(file, 'utf8').matchAll(localeKeyRe)) templateKeys.add(match[2]!);
    }
    const zhKeySet = new Set(zhKeys);
    const missingKeys = [...templateKeys].sort().filter((key) => !zhKeySet.has(key));
    assert(
        templateKeys.size > 100 && missingKeys.length === 0,
        `模板引用的 ${templateKeys.size} 个字面量键都在 locales 里存在（缺失：${missingKeys.slice(0, 5).join(', ') || '无'}）`,
    );

    /**
     * 动态键的引用侧：侧栏与设置子导航的文案经 `t(link.labelKey)` 取，上面那条字面量正则匹配不到它们。
     *
     * 这两张表是「唯一一份」的约定所在（导航、设置路由都只此一处），也正因如此，改名只会在这里断掉：
     * 表现是侧栏某一项渲染成裸键名 `nav.foo`，或者新增一页时locales 补了、表里的 key 拼错，界面不报错只是不说人话。
     */
    const { WORK_NAV_LINKS } = await import('../app/utils/work-nav');
    const { WORK_SETTINGS_PAGES } = await import('../app/utils/work-settings');
    const navKeys = WORK_NAV_LINKS.map((link) => link.labelKey);
    const settingsKeys = WORK_SETTINGS_PAGES.flatMap((page) => [page.labelKey, page.descKey]);
    const tableKeys = [...new Set([...navKeys, ...settingsKeys])];
    const missingTableKeys = tableKeys.filter((key) => !zhKeySet.has(key));
    assert(
        tableKeys.length >= 15 && missingTableKeys.length === 0,
        `导航与设置表引用的 ${tableKeys.length} 个动态键都在 locales 里存在（缺失：${missingTableKeys.join(', ') || '无'}）`,
    );

    // 图标名同样只在这两张表里写一次：名字拼错时 AppIcon 只画一个占位方框，没有任何报错
    const { APP_ICONS } = await import('../app/utils/app-icons');
    const tableIcons = [...new Set([...WORK_NAV_LINKS.map((link) => link.icon), ...WORK_SETTINGS_PAGES.map((page) => page.icon)])];
    const missingIcons = tableIcons.filter((name) => !(name in APP_ICONS));
    assert(
        tableIcons.length >= 8 && missingIcons.length === 0,
        `导航与设置表用到的 ${tableIcons.length} 个图标都已打包（缺失：${missingIcons.join(', ') || '无'}；新增图标要改 generate-icons.mjs 再跑 icons）`,
    );

    /**
     * 表里的 `to` 必须有对应页面文件。这两张表是唯一的路由清单，写错的表现是「菜单里看得到、点进去 404」，
     * 而 Nuxt 的文件路由不会给这张表任何类型检查。
     */
    const pagesRoot = resolve(HERE, '../app/pages');
    /** `to` 带前导斜杠，直接交给 resolve 会被当成「盘根绝对路径」，必须剥掉后按段拼。 */
    const hasPage = (to: string) => {
        const segments = to.replace(/^\//, '').split('/').filter(Boolean);
        return existsSync(resolve(pagesRoot, ...segments, 'index.vue')) || (segments.length > 0 && existsSync(`${resolve(pagesRoot, ...segments)}.vue`));
    };
    const deadTargets = [...WORK_NAV_LINKS, ...WORK_SETTINGS_PAGES].filter((item) => !hasPage(item.to)).map((item) => item.to);
    assert(
        deadTargets.length === 0,
        `导航与设置表的 ${WORK_NAV_LINKS.length + WORK_SETTINGS_PAGES.length} 个目标都有页面文件（悬空：${deadTargets.join(', ') || '无'}）`,
    );

    // 17. 后台生成的回放缓冲（chat-runs）：切页面/刷新不打断生成，靠的就是这份内存副本
    console.log('\n17. 测试对话后台运行的回放缓冲');
    const {
        beginChatRun,
        appendChatChunk,
        endChatRun,
        getChatRun,
        subscribeChatRun,
        createChatRunStream,
        tapChatRun,
        runningConversationIds,
        dropChatRun,
        abortChatRun,
    } = await import('../server/utils/chat-runs');
    const runA = beginChatRun('11111111-1111-4111-8111-111111111111');
    appendChatChunk(runA, { type: 'text-start', id: '0' } as never);
    appendChatChunk(runA, { type: 'text-delta', id: '0', delta: '前半' } as never);
    assert(getChatRun(runA.conversationId) === runA, '未结束的轮次可被重连接口取到');
    assert(runningConversationIds().includes(runA.conversationId), '在途轮次出现在 /api/chat/runs 的口径里');

    // 迟到的订阅者必须先从头追上已缓冲的分片，再收实时分片——这是「刷新后接着看逐字流」的实现
    const seenLate: string[] = [];
    let lateEnded = 0;
    const unsubscribeLate = subscribeChatRun(
        runA,
        (line) => seenLate.push(JSON.parse(line).delta ?? JSON.parse(line).type),
        () => lateEnded++,
    );
    appendChatChunk(runA, { type: 'text-delta', id: '0', delta: '后半' } as never);
    assert(seenLate.join('') === 'text-start前半后半', '重连侧先回放缓冲分片、再继续收新分片');

    endChatRun(runA);
    assert(lateEnded === 1, '轮次收尾时通知订阅者关流');
    assert(seenLate.length === 3 && lateEnded === 1, '收尾不会重复吐分片');
    assert(!runningConversationIds().includes(runA.conversationId), '已结束的轮次不再算作在途');

    // 收尾之后立刻切回页面的重连仍然要能拿到整轮（宽限期内缓冲还在）
    const afterFinish: string[] = [];
    let afterEnded = 0;
    subscribeChatRun(
        runA,
        (line) => afterFinish.push(line),
        () => afterEnded++,
    );
    assert(afterFinish.length === 3 && afterEnded === 1, '结束后仍完整回放并立即关流');

    // 缓冲必须有上限：越限的那一轮不再供回放，但原响应流一个字都不能少
    const runBig = beginChatRun('22222222-2222-4222-8222-222222222222');
    const huge = { type: 'text-delta', id: '0', delta: 'x'.repeat(160 * 1024) } as never;
    for (let i = 0; i < 6; i += 1) appendChatChunk(runBig, huge);
    assert(runBig.overflow === true, '超过字节上限后标记为溢出并放弃缓冲');
    assert(getChatRun(runBig.conversationId) === null, '溢出的轮次回 204，让客户端走数据库历史回源');

    const runTap = beginChatRun('33333333-3333-4333-8333-333333333333');
    const tapped = tapChatRun(
        new ReadableStream({
            start(controller) {
                controller.enqueue({ type: 'text-start', id: '0' });
                controller.enqueue({ type: 'text-fin', id: '0' });
                controller.close();
            },
        }),
        runTap,
    );
    const drained: string[] = [];
    const tapReader = tapped.getReader();
    for (;;) {
        const next = await tapReader.read();
        if (next.done) break;
        drained.push(JSON.stringify(next.value));
    }
    assert(drained.length === 2 && runTap.lines.length === 2, '打流是旁路：透传的分片数与缓冲记录一致');
    assert(runTap.finished, '源流读完即收尾，缓冲不会一直挂在在途列表里');

    // 重连接口给出的就是这条流：构造时先吐缓冲、实时分片继续跟，收尾后读到底即 done
    const runReplay = beginChatRun('55555555-5555-5555-8555-555555555555');
    appendChatChunk(runReplay, { type: 'text-start', id: '0' } as never);
    const replayReader = createChatRunStream(runReplay).getReader();
    appendChatChunk(runReplay, { type: 'text-delta', id: '0', delta: '重连' } as never);
    endChatRun(runReplay);
    const replayed: string[] = [];
    for (;;) {
        const next = await replayReader.read();
        if (next.done) break;
        replayed.push(JSON.stringify(next.value));
    }
    assert(
        replayed.length === 2 && replayed[0]?.includes('text-start') === true && replayed[1]?.includes('重连') === true,
        '重连流回放缓冲分片后再实时续读，收尾会正常关流',
    );

    // 同一段会话连开两轮（并发护栏被绕过时）不能让两条回放互相覆盖；删会话要连带丢掉回放
    const firstRun = beginChatRun('44444444-4444-4444-8444-444444444444');
    const secondRun = beginChatRun('44444444-4444-4444-8444-444444444444');
    assert(
        firstRun.finished && firstRun.controller.signal.aborted === true && getChatRun(secondRun.conversationId) === secondRun,
        '同会话重开一轮会先掐掉上一轮的模型调用并收尾，回放只有一份',
    );
    dropChatRun(secondRun.conversationId);
    assert(getChatRun(secondRun.conversationId) === null, '删除会话后不再回放它的那一轮');
    let doubleUnsubscribe = '';
    try {
        unsubscribeLate();
        unsubscribeLate();
    } catch (e) {
        doubleUnsubscribe = String(e);
    }
    assert(doubleUnsubscribe === '', '退订可重复调用而不抛错（订阅者会在回调里注销自己）');

    // 「停止」必须真的能掐住那一轮：客户端 stop() 只断开浏览器读取，服务端照跑照落库
    const runStop = beginChatRun('66666666-6666-6666-8666-666666666666');
    assert(runStop.controller.signal.aborted === false, '新轮次的中止闸门初始是关着的');
    assert(abortChatRun(runStop.conversationId) === true, '在途轮次可被中断');
    assert(runStop.controller.signal.aborted === true, '中断即 abort，streamText 收到信号才停得下来');
    assert(abortChatRun(runStop.conversationId) === false, '已中断的轮次再点是空操作（幂等，界面不该报「停止失败」）');
    assert(abortChatRun('77777777-7777-7777-8777-777777777777') === false, '没有这一轮时回 false 而不是抛错');
    endChatRun(runStop);
    const runDone = beginChatRun('88888888-8888-8888-8888-888888888888');
    endChatRun(runDone);
    assert(runDone.controller.signal.aborted === false, '正常跑完的轮次不会被中止信号误伤（部分回复不该被当成中断落库）');
    const runDelete = beginChatRun('99999999-9999-9999-8999-999999999999');
    dropChatRun(runDelete.conversationId);
    assert(runDelete.controller.signal.aborted === true, '删除会话连带掐掉仍在跑的模型调用');

    // 越过容量上限时只能淘汰**已结束**的轮次：客户端（useChatRuns 的 INSTANCE_LIMIT=12）会留住每一个在跑的实例，
    // 服务端把活轮次踢出表，那条就同时失去「停止」（abort 送不到 streamText，模型照读完、照烧额度，界面却显示已停）
    // 与「生成中」标记（/api/chat/runs 漏报），重连还会拿到 204 而复位成 ready。
    const crowded: string[] = [];
    for (let i = 0; i < 14; i += 1) {
        const crowdedId = `cafe00${String(i).padStart(2, '0')}-0000-4000-8000-000000000000`;
        beginChatRun(crowdedId);
        crowded.push(crowdedId);
    }
    assert(
        crowded.every((id) => getChatRun(id) !== null),
        '超过容量上限也不会淘汰仍在生成的轮次',
    );
    assert(abortChatRun(crowded[0]!) === true, '最早开跑的那一轮越过上限后仍能被「停止」找到');
    for (const id of crowded) dropChatRun(id);

    // 18. 数据库连通性与核心表（可选：本机未起数据库时跳过）
    console.log('\n18. 测试数据库连通性与核心数据表');
    try {
        const { sql } = await import('drizzle-orm');
        const { db } = await import('../server/utils/db');
        await db.execute(sql`SELECT 1`);
        assert(true, 'PostgreSQL 数据库连通正常');
        for (const [name, table] of [
            ['schedules', schema.schedules],
            ['agents', schema.agents],
            ['conversations', schema.conversations],
            ['messages', schema.messages],
        ] as const) {
            const [row] = await db.select({ count: sql<number>`count(*)` }).from(table);
            assert(Number(row?.count ?? 0) >= 0, `${name} 表可正常查询`);
        }
        const indexRows = (await db.execute(sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'session_runs_request_active_idx'`)) as unknown as {
            indexdef: string;
        }[];
        assert(indexRows.length === 1 && /UNIQUE/i.test(indexRows[0]!.indexdef), 'requestId 幂等唯一索引已落库');

        const { eq } = await import('drizzle-orm');
        const { startSessionRun } = await import('../server/utils/session-runs');
        const agentId = 'smoke-idx-agent';
        const agentId2 = 'smoke-idx-agent-2';
        const conversationId = 'smoke-idx-conversation';
        const requestId = `smoke-idem-${Date.now()}`;
        try {
            await db.insert(schema.agents).values({ id: agentId, name: 'smoke-index-agent' }).onConflictDoNothing();
            await db.insert(schema.agents).values({ id: agentId2, name: 'smoke-index-agent-2' }).onConflictDoNothing();
            await db.insert(schema.conversations).values({ id: conversationId, title: 'smoke-index', agentId }).onConflictDoNothing();
            const first = await startSessionRun({ conversationId, requestId });
            let conflict = false;
            try {
                await startSessionRun({ conversationId, requestId });
            } catch (error: any) {
                conflict = error?.statusCode === 409 && error?.data?.duplicate === true;
            }
            assert(Boolean(first) && conflict, '并发同 requestId 的第二次写入被唯一索引拦成 409');

            // 真正并发：6 个请求同时插入同一 (conversation, requestId)，只应有一个成功
            const raceRequestId = `smoke-race-${Date.now()}`;
            const race = await Promise.allSettled(Array.from({ length: 6 }, () => startSessionRun({ conversationId, requestId: raceRequestId })));
            const raceWon = race.filter((item) => item.status === 'fulfilled').length;
            const raceConflicts = race.filter(
                (item) => item.status === 'rejected' && (item.reason as any)?.statusCode === 409 && (item.reason as any)?.data?.duplicate === true,
            ).length;
            assert(raceWon === 1 && raceConflicts === 5, `并发 6 个同 requestId 只成功 1 个（实际成功 ${raceWon}、409 ${raceConflicts}）`);

            const { appendSessionEvents, readSessionEventsBefore } = await import('../server/agent/session/events');
            const seqs = await appendSessionEvents(
                conversationId,
                Array.from({ length: 5 }, (_, index) => ({ type: 'system/message' as const, data: { text: `before-page-${index + 1}` } })),
            );
            const latest = await readSessionEventsBefore(conversationId, 999, 2);
            const middle = await readSessionEventsBefore(conversationId, 3, 1);
            assert(
                seqs.length === 5 && latest.rows.map((row) => row.seq).join(',') === '4,5' && latest.hasMore,
                '反向分页取最近一页并按 seq 升序返回，同时报告还有更早事件',
            );
            assert(middle.rows.map((row) => row.seq).join(',') === '2' && middle.hasMore, 'before 精确排除边界并正确报告还有更早事件');

            const { buildBackupPage } = await import('../server/utils/backup-pages');
            const page1 = await buildBackupPage('agents', null, 1);
            const page2 = await buildBackupPage('agents', page1.nextAfter, 1);
            assert(
                page1.rows.length === 1 && page1.hasMore && page2.rows.length === 1 && page1.rows[0]!.id !== page2.rows[0]!.id,
                'NDJSON 单表分页按主键游标取下一页，不重复上一页的行',
            );
            let cursorRejected = false;
            try {
                await buildBackupPage('sessionEvents', ['only-one-column'], 1);
            } catch {
                cursorRejected = true;
            }
            assert(cursorRejected, '复合主键表的单列游标被拒绝，不会静默跳行');
        } finally {
            await db.delete(schema.sessionRuns).where(eq(schema.sessionRuns.requestId, requestId));
            await db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
            await db.delete(schema.agents).where(eq(schema.agents.id, agentId));
            await db.delete(schema.agents).where(eq(schema.agents.id, agentId2));
        }
    } catch (e: any) {
        console.warn('  ⚠️ 数据库未运行或无法连接，跳过真实 DB 查询:', e?.message);
    }

    // 19. 前后端档位对账：work 的前端不 import 服务端，表单档位是抄一份的，
    //     抄漏一次的表现是「界面填得进、保存被 400」或反过来「服务端放宽了、表单还卡在旧值」，两边都不报错。
    console.log('\n19. 测试前后端档位常量一致');
    const feWorkText = readFileSync(resolve(HERE, '../app/utils/work.ts'), 'utf8');
    const feTasksText = readFileSync(resolve(HERE, '../app/pages/tasks.vue'), 'utf8');
    /** 取 `export const NAME = <数字或乘法式>;` 的数值（前端那份刻意写成字面量，所以能按文本取）。 */
    const numConstOf = (src: string, name: string): number | null => {
        const matched = new RegExp(`^export const ${name}(?::[^=]+)? = ([0-9_]+(?:\\s*\\*\\s*[0-9_]+)*);`, 'm').exec(src);
        if (!matched) return null;
        return matched[1]!.split('*').reduce((acc, part) => acc * Number(part.trim().replace(/_/g, '')), 1);
    };
    /** 取 `export const NAME = [...]` 里的引号项。 */
    const listOf = (src: string, name: string): string[] | null => {
        const matched = new RegExp(`^export const ${name}(?::[^=]+)? = \\[([^\\]]*)\\]`, 'm').exec(src);
        return matched ? [...matched[1]!.matchAll(/'([^']+)'/g)].map((item) => item[1]!) : null;
    };
    const beScheduleText = readFileSync(resolve(HERE, '../server/utils/work-schedule.ts'), 'utf8');
    for (const name of ['SCHEDULE_PROMPT_MAX', 'INTERVAL_MINUTES_MIN', 'INTERVAL_MINUTES_MAX', 'INTERVAL_DEFAULT_MINUTES']) {
        const be = numConstOf(beScheduleText, name);
        const fe = numConstOf(feWorkText, name);
        assert(be !== null && fe !== null && be === fe, `${name} 前后端同值（服务端 ${be} / 前端 ${fe}）`);
    }
    const beKinds = listOf(readFileSync(resolve(HERE, '../server/db/schema.ts'), 'utf8'), 'SCHEDULE_KINDS');
    const feKinds = listOf(feWorkText, 'SCHEDULE_KIND_OPTIONS');
    assert(
        !!beKinds && !!feKinds && [...beKinds].sort().join(',') === [...feKinds].sort().join(','),
        `排期类型集合一致（服务端 ${beKinds} / 前端 ${feKinds}；下拉顺序可以不同，缺一项就是建得出来却归不了类）`,
    );
    /** 数字型 `maxlength` 一律要能在服务端档位里找到同名值：裸数字是这套表单唯一的漂移点。 */
    const beTitleMax = numConstOf(readFileSync(resolve(HERE, '../server/utils/work-input.ts'), 'utf8'), 'WORK_TITLE_MAX');
    const maxlengths = [...feTasksText.matchAll(/maxlength="(\d+)"/g)].map((matched) => Number(matched[1]));
    assert(
        maxlengths.length > 0 && maxlengths.every((value) => value === beTitleMax),
        `排期表单的数字 maxlength 等于服务端 WORK_TITLE_MAX（表单 ${[...new Set(maxlengths)].join(', ') || '无'} / 服务端 ${beTitleMax}）`,
    );

    /**
     * 「日期 + 钟点」的两侧对拍：表单合成 `startsAt` 的那段算法与服务端 `work-day.ts` 各写了一份
     * （客户端不能 import 服务端），所以只能用真实输入把两份钉在一起。
     * 漂移的表现是「界面写着明天 09:00，落库是今天 09:00」——排期会提前一天跑，用户只会看到结果来得莫名其妙。
     */
    const { composeStartsAt } = await import('../app/utils/work-day');
    const { fromShanghaiParts } = await import('../server/utils/work-day');
    const dayTimePairs = [
        ['2026-02-28', '09:00'],
        ['2026-07-15', '23:59'],
        ['2026-12-31', '18:30'],
        ['2027-01-01', '07:05'],
        ['2028-02-29', '00:00'],
    ] as const;
    assert(
        dayTimePairs.every(
            ([day, time]) =>
                composeStartsAt(day, time) ===
                fromShanghaiParts(
                    Number(day.slice(0, 4)),
                    Number(day.slice(5, 7)),
                    Number(day.slice(8, 10)),
                    Number(time.slice(0, 2)),
                    Number(time.slice(3, 5)),
                ).toISOString(),
        ),
        '表单合成的 startsAt 与服务端「北京年月日时分 → 绝对时刻」逐点一致（含闰日、跨年、午夜与 23:59）',
    );
    assert(
        ['2026-02-29', '2026-02-30', '2026-13-01'].every((day) => composeStartsAt(day, '09:00') === null),
        '日历上不存在的日期直接拒绝，不让 Date.UTC 顺延成别的一天（选了 2/29 却存成 3/1）',
    );
    assert(
        composeStartsAt('', '09:00') === null && composeStartsAt('2026-3-1', '09:00') === null && composeStartsAt('2026-03-01 09:00', '09:00') === null,
        '空日期与「看着像日期但不是 YYYY-MM-DD」的形状都回 null，不猜成某一天',
    );

    console.log('\n20. 测试执行结论的对外口径（lastError 有两条出口：列表渲染与 work_today 的工具结果）');
    const { RunFailure, describeRunError, cancelScheduleRun, isScheduleRunActive } = await import('../server/utils/schedule-runner');
    assert(!cancelScheduleRun('no-such-run') && !isScheduleRunActive('no-such-run'), '取消未知运行返回 false，不把历史行误报成已中断');
    const sqlFailure = Object.assign(new Error('Failed query: insert into "messages" ("id","conversation_id","parts") values ($1, $2, $3) - duplicate key'), {
        name: 'QueryFailedError',
        query: 'insert into "messages" ...',
        parameters: ['cmsg_x', 'conv_x', [{ type: 'text', text: '这条排期的 prompt 正文' }]],
    });
    assert(
        describeRunError(sqlFailure) === '数据库写入失败' && !describeRunError(sqlFailure).includes('Failed query'),
        'drizzle 的 SQL 与绑定参数不进 lastError（那里装着用户写的正文，且会被 work_today 发给外部供应商）',
    );
    assert(describeRunError(new RunFailure('模型没有返回可用正文')) === '模型没有返回可用正文', '自己造的失败原样展示，不折成一句类别');
    assert(
        describeRunError(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })).includes('超时'),
        '中断/超时单独成一类：供应商停摆与数据库写失败是两套排查方向',
    );
    assert(
        describeRunError(Object.assign(new Error('429 Too Many Requests'), { statusCode: 429 })) === '模型或工具调用失败（上游返回了错误状态）' &&
            describeRunError(new Error('连接被拒绝')) === '模型或工具调用失败',
        '上游状态与未知异常各归一类，任何一条都不带原始文本',
    );

    assert(
        describeRunError(Object.assign(new RunFailure('模型没有返回可用正文'), { statusCode: 404, statusMessage: '智能体不存在' })) === '模型没有返回可用正文',
        'RunFailure 的判定排在 createError 之前：抛它的人手上的文案比任何分类都准',
    );
    assert(
        describeRunError({ statusCode: 404, statusMessage: '智能体不存在', message: '智能体不存在' }) === '智能体不存在',
        'h3 createError 的形状（statusCode + statusMessage）算「我们自己的结论」，不被误判成上游错误',
    );

    console.log('\n21. 测试事件投影（P1：session_events → messages）');
    const { deriveMessages } = await import('../server/agent/session/projection');
    const baseEvent = { createdAt: new Date(0), surfaceOp: null };
    const projected = deriveMessages([
        { ...baseEvent, seq: 1, type: 'user/message', data: { id: 'u1', parts: [{ type: 'text', text: '问题一' }] } },
        { ...baseEvent, seq: 2, type: 'assistant/message', data: { id: 'a1', parts: [{ type: 'text', text: '回答一' }] } },
        { ...baseEvent, seq: 3, type: 'request/header', data: { model: 'm' } },
        { ...baseEvent, seq: 4, type: 'system/message', data: { text: '系统注入' } },
        { ...baseEvent, seq: 5, type: 'run/end', data: { status: 'completed' } },
    ]);
    assert(
        projected.map((message) => message.id).join(',') === 'u1,a1,system:4' && projected.map((message) => message.role).join(',') === 'user,assistant,system',
        '只折叠 user/assistant/system 事件，request/header 与 run/* 不进入历史',
    );
    assert(
        JSON.stringify(projected[2]?.parts) === JSON.stringify([{ type: 'text', text: '系统注入' }]),
        'system/message 的 text 回退成 text part，不丢系统注入',
    );
    const compacted = deriveMessages([
        { ...baseEvent, seq: 1, type: 'user/message', data: { id: 'u1', parts: [{ type: 'text', text: '问题一' }] } },
        { ...baseEvent, seq: 2, type: 'assistant/message', data: { id: 'a1', parts: [{ type: 'text', text: '回答一' }] } },
        { ...baseEvent, seq: 3, type: 'system/message', data: { id: 'summary', text: '摘要', compaction: true } },
        { ...baseEvent, seq: 4, type: 'user/message', data: { id: 'u4', parts: [{ type: 'text', text: '近期问题' }] } },
        { ...baseEvent, seq: 5, type: 'assistant/message', data: { id: 'a5', parts: [{ type: 'text', text: '近期回答' }] } },
        { ...baseEvent, seq: 6, type: 'compaction/end', surfaceOp: { op: 'replace', fromSeq: 1, toSeq: 2 }, data: {} },
    ]);
    assert(
        compacted.map((message) => message.id).join(',') === 'summary,u4,a5',
        'surface_op=replace 的区间被摘要遮蔽；压缩摘要排到保留消息之前，原事件仍保留可审计',
    );

    const checkpointed = deriveMessages([
        { ...baseEvent, seq: 1, type: 'user/message', turnId: 't1', data: { id: 'u1', parts: [{ type: 'text', text: '问题一' }] } },
        {
            ...baseEvent,
            seq: 2,
            type: 'assistant/message',
            turnId: 't1',
            data: { id: 'checkpoint:t1:0', checkpoint: true, parts: [{ type: 'text', text: '半截' }] },
        },
        { ...baseEvent, seq: 3, type: 'assistant/message', turnId: 't1', data: { id: 'a1', parts: [{ type: 'text', text: '完整回答' }] } },
        { ...baseEvent, seq: 4, type: 'user/message', turnId: 't2', data: { id: 'u2', parts: [{ type: 'text', text: '问题二' }] } },
        {
            ...baseEvent,
            seq: 5,
            type: 'assistant/message',
            turnId: 't2',
            data: { id: 'checkpoint:t2:0', checkpoint: true, parts: [{ type: 'text', text: '中断前正文' }] },
        },
    ]);
    assert(
        checkpointed.map((message) => message.id).join(',') === 'u1,a1,u2,checkpoint:t2:0',
        '最终 assistant 消息存在时丢弃同轮检查点；崩溃轮次保留检查点供 UI 显示半截回复',
    );

    const { estimateMessageTokens, estimateTokens, measureSurface } = await import('../server/agent/session/token-meter');
    assert(estimateTokens('abcdefgh') === 2 && estimateTokens('') === 0, 'token 估算按 4 字符/token，空串为 0');
    assert(
        estimateMessageTokens([
            { role: 'user', content: 'abcd' },
            { role: 'assistant', content: 'efgh' },
        ]) === 10,
        '消息窗口估算含每条 4 token 的角色开销',
    );
    assert(measureSurface([{ role: 'user', content: 'abcd' }], 1000, 0.7).budget === 700, '上下文预算 = 窗口 × 0.7');

    const { buildCompactionPrompt, planCompaction, shouldAutoCompact } = await import('../server/agent/session/compaction');
    const compactionMessages = Array.from({ length: 6 }, (_, index) => ({
        id: `m${index + 1}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        parts: [{ type: 'text', text: `第${index + 1}条，${'x'.repeat(400)}` }],
        seq: index + 1,
        createdAt: new Date(),
    }));
    const plan = planCompaction(compactionMessages, 100);
    assert(plan?.fromSeq === 1 && plan?.toSeq === 4 && plan?.messages === 4, '压缩计划只取前缀，至少保留最近两条消息');
    assert(planCompaction(compactionMessages.slice(0, 2), 100) === null, '短会话不触发压缩');
    assert(buildCompactionPrompt(compactionMessages).includes('【user】'), '压缩提示词按角色拼接旧消息');
    assert(shouldAutoCompact(70_001, 4, 24, 100_000) && !shouldAutoCompact(70_000, 4, 24, 100_000), '自动压缩只在超过 70% 预算时触发');
    assert(shouldAutoCompact(1, 24, 24, 100_000), '窗口顶到 24 条时也触发自动压缩');
    const { extractFileDiff } = await import('../app/utils/timeline');
    const diff = extractFileDiff('local_edit_file', { oldText: 'const a = 1;', newText: 'const a = 2;' });
    assert(diff?.oldText === 'const a = 1;' && diff?.newText === 'const a = 2;' && diff?.truncated === false, '时间线从 local_edit_file 入参提取 diff');
    assert(extractFileDiff('local_read_file', { oldText: 'a', newText: 'b' }) === null, '只读工具不产生 diff');
    const longDiff = extractFileDiff('local_edit_file', { oldText: 'x'.repeat(2100), newText: 'y' });
    assert(longDiff?.truncated === true && longDiff.oldText.length === 2001 && longDiff.oldText.endsWith('…'), '过长的 diff 截到 2000 字符并标记');
    const { chatErrorHintKey } = await import('../app/utils/chat-error');
    assert(chatErrorHintKey({ data: { code: 'TOOL_TIMEOUT' } }) === 'chat.errorHintTimeout', '错误码 TOOL_TIMEOUT 映射到超时提示');
    assert(chatErrorHintKey(new Error('文件已被修改，请重新读取')) === 'chat.errorHintStaleFile', '错误文案命中文件版本冲突提示');
    assert(chatErrorHintKey({ status: 429, message: '请求过于频繁' }) === 'chat.errorHintRateLimited', '429 映射到限流提示');
    assert(chatErrorHintKey('invalid requestId') === null, '未知错误不硬套提示');

    const { getKbReindexJob, resetKbReindexJobs, startKbReindex } = await import('../server/utils/kb-reindex');
    resetKbReindexJobs();
    const missingKbId = '00000000-0000-4000-8000-000000000000';
    let missingKbStatus = 0;
    try {
        await startKbReindex(missingKbId);
    } catch (error) {
        missingKbStatus = (error as { statusCode?: number }).statusCode ?? 0;
    }
    const failedReindex = getKbReindexJob(missingKbId);
    assert(
        missingKbStatus === 404 && failedReindex?.status === 'failed' && failedReindex.kbId === missingKbId,
        '重建任务先占位再校验：不存在的知识库返回 404，任务快照落为 failed 而不是消失',
    );
    assert(getKbReindexJob('00000000-0000-4000-8000-000000000001') === null, '没有任务的知识库返回 null，不伪造进度');
    resetKbReindexJobs();

    const { requiresApproval, riskOfTool } = await import('../server/agent/policy/approval');
    assert(riskOfTool('work_today') === 'read' && riskOfTool('work_create_schedule') === 'write', '工具风险按读写分类');
    assert(riskOfTool('run_command') === 'execute' && riskOfTool('mcp_github') === 'network', '执行与网络工具单独分类');

    const { applyToolRegistry, getToolMetrics, resetToolMetrics, wrapToolWithRegistry } = await import('../server/agent/tool-registry');
    resetToolMetrics();
    const registry = applyToolRegistry({
        registry_big: { description: 'big', inputSchema: {}, execute: async () => ({ blob: 'x'.repeat(30_000) }) } as any,
        registry_ok: { description: 'ok', inputSchema: {}, execute: async () => ({ ok: true }) } as any,
        registry_slow: { description: 'slow', inputSchema: {}, execute: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 200)) } as any,
    });
    assert(((await (registry.registry_big as any).execute({}, {})) as any).truncated === true, '工具输出超限时返回 truncated 预览');
    assert(((await (registry.registry_ok as any).execute({}, {})) as any).ok === true, '未超限输出原样返回');
    let timeoutCode = '';
    try {
        await (
            wrapToolWithRegistry(
                'registry_slow',
                { description: 'slow', inputSchema: {}, execute: () => new Promise((resolve) => setTimeout(resolve, 200)) } as any,
                { timeoutMs: 20 },
            ) as any
        ).execute({}, {});
    } catch (error) {
        timeoutCode = (error as { code?: string }).code ?? '';
    }
    assert(timeoutCode === 'TOOL_TIMEOUT', '工具超时映射为 TOOL_TIMEOUT');
    const metrics = getToolMetrics();
    assert(metrics.registry_big?.calls === 1 && metrics.registry_big?.truncated === 1, '注册表按工具累计调用与截断');
    assert(metrics.registry_slow?.timeouts === 1, '注册表累计超时');
    resetToolMetrics();
    assert(requiresApproval('auto', 'write') === false && requiresApproval('auto', 'execute') === true, 'auto 模式写自动、执行需审批');
    assert(
        requiresApproval('ask', 'write') === true && requiresApproval('ask', 'read') === false && requiresApproval('never', 'write') === true,
        'ask 询问非读工具，never 拒绝非读工具',
    );

    const { pairToolEvents, unpairedToolCalls } = await import('../server/agent/session/projection');
    const toolEvents = [
        { ...baseEvent, seq: 1, type: 'tool/call', data: { toolCallId: 'c1', toolName: 'work_today', input: {} } },
        { ...baseEvent, seq: 2, type: 'tool/result', data: { toolCallId: 'c1', toolName: 'work_today', output: 'ok', isError: false } },
        { ...baseEvent, seq: 3, type: 'tool/call', data: { toolCallId: 'c2', toolName: 'local_read_file', input: { path: 'x' } } },
    ];
    assert(
        pairToolEvents(toolEvents).length === 2 && pairToolEvents(toolEvents)[0]?.resultSeq === 2 && pairToolEvents(toolEvents)[0]?.isError === false,
        'tool/call 与 tool/result 按 toolCallId 成对，结果 seq 记在 call 上',
    );
    assert(
        unpairedToolCalls(toolEvents)
            .map((pair) => pair.toolCallId)
            .join(',') === 'c2',
        '有 call 无 result 的工具被单独列出：崩溃恢复只能标未知，不能自动重跑',
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
