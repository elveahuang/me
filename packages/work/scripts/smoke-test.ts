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
    assert(likePattern('C:\\work\\') === '%C:\\\\work\\\\%', '反斜杠成对转义：不转义时 LIKE 的 escape 缺失会让 PG 以 22025 炸成 500');
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

    // 11. 工作台写入归一与北京日口径（notes 各 handler 与定时任务共用的同一套规则）
    console.log('\n11. 测试工作台写入归一与北京日口径');
    const { WORK_TITLE_MAX, normalizeNoteKind, normalizeWorkDate, normalizeWorkId, normalizeWorkOptionalText, normalizeWorkTags, normalizeWorkText } =
        await import('../server/utils/work-input');
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
        normalizeNoteKind(undefined) === 'note' && threw400(() => normalizeNoteKind('one')),
        '枚举缺失回退、未知值拒绝：静默落库的坏类型会让笔记在按 kind 筛选的列表里凭空消失',
    );
    assert(normalizeWorkTags(['a', 'a', '  ', 2026, {}, null, 'b']).join(',') === 'a,2026,b', '标签去重、标量字符串化、对象与空串丢弃');
    assert(
        threw400(() => normalizeWorkTags('a,b')) && threw400(() => normalizeWorkId('not-a-uuid', 'agentId')),
        'tags 非数组与 id 形状不对都回 400（省一次无谓查库）',
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
    assert(primaryOf(schema.briefs).join(',') === 'brief_date', '简报以日期为主键（定时任务重复触发靠 upsert 幂等）');
    assert(
        ['orders', 'membershipPlans', 'user', 'users'].every((k) => !(k in schema)),
        'schema 里没有订单/会员/账号表（fork 时刻意不带）',
    );
    // 待办、项目、日程三条链路已整机移除：表留在库里等于给旧深链留一个「页面没了但接口还通」的半成品
    assert(
        ['projects', 'tasks', 'events'].every((k) => !(k in schema)),
        'schema 里没有 projects/tasks/events 表（含引用它们的项目、日历与提醒代码一并删净）',
    );
    assert(!columnsOf(schema.notes).includes('project_id'), 'notes 没有 project_id 列（笔记不再归属项目）');
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
    const exportText = readFileSync(resolve(HERE, '../server/api/export.get.ts'), 'utf8');
    const builtTables = new Set([...exportText.matchAll(/\.from\(\s*([A-Za-z]+)\s*\)/g)].map((matched) => matched[1]!));
    // 刻意不进备份的派生数据：知识库分块与向量可重建（导入后「重建索引」），文件里也丢掉了
    const SKIPPED_TABLES = new Set(['kbChunks']);
    const uncovered = schemaTables.filter((name) => !builtTables.has(name) && !SKIPPED_TABLES.has(name));
    assert(
        schemaTables.length >= 19 && uncovered.length === 0,
        `export 覆盖 schema 的全部 ${schemaTables.length} 张表（未覆盖：${uncovered.join(', ') || '无'}；派生数据除外）`,
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

    // 15. 笔记摘要与 Markdown 归一（索引纯函数面，不碰库不外呼）
    console.log('\n15. 测试笔记摘要归一');
    const { NOTE_SUMMARY_MAX, deriveNoteSummary, markdownToPlainText } = await import('../server/utils/note-index');
    assert(
        markdownToPlainText('## 周报\n\n- **完成** [登录](https://x.test/a)\n- 修复 `bug`') === '周报 完成 登录 修复 bug',
        '标题/列表/加粗/链接/行内代码都归一成可读纯文本',
    );
    assert(markdownToPlainText('```ts\nconst a = 1;\n```') === '', '代码围栏整段丢弃：里面是符号不是语义，进摘要只会把列表挤满乱码');
    assert(deriveNoteSummary('# 标题\n\n正文一句', '兜底标题') === '标题 正文一句', '摘要走同一套 Markdown 归一');
    assert(deriveNoteSummary('', '只有标题') === '只有标题', '正文为空回退标题，列表不至于两栏都空');
    assert(deriveNoteSummary('', '') === '', '正文与标题皆空回退空串而不是 undefined');
    const longSummary = deriveNoteSummary('内'.repeat(NOTE_SUMMARY_MAX + 50));
    assert(longSummary.length === NOTE_SUMMARY_MAX + 1 && longSummary.endsWith('…'), `摘要封顶 ${NOTE_SUMMARY_MAX} 字符（正文可达数百 KB，摘要会进提示词）`);

    // 16. 简报日期入参与 AI 工具桥口径
    console.log('\n16. 测试简报入参与工具桥一致性');
    const { briefDateInput } = await import('../server/utils/brief');
    assert(briefDateInput('2026-10-15')?.toISOString() === '2026-10-14T16:00:00.000Z', '?date 按北京日解释成当天起点');
    assert(
        briefDateInput(undefined) === null && briefDateInput('tomorrow') === null && briefDateInput('2026-02-30') === null,
        '缺失/非日期/假日期回退 null（= 今天）而不是 Invalid Date',
    );

    const { WORKBENCH_TOOL_SUMMARY, buildWorkbenchTools } = await import('../server/utils/workbench-tools');
    const workbenchTools = buildWorkbenchTools('00000000-0000-4000-8000-000000000000');
    const toolNames = Object.keys(workbenchTools).sort();
    assert(
        toolNames.join(',') === ['work_create_note', 'work_create_schedule', 'work_list_schedules', 'work_search', 'work_today'].sort().join(','),
        '五个工作台动作全部注册为模型可见工具，且没有多出的（待办与日程已随表删除，留着就是模型每轮都能调一个必然失败的旧动作）',
    );
    assert(
        toolNames.every((name) => WORKBENCH_TOOL_SUMMARY.includes(name)),
        '系统提示词的工具清单与真实工具同名：提示里写一个不存在的工具，模型每轮都会空跑一次失败调用',
    );
    assert(
        Object.values(workbenchTools).every((item: any) => typeof item.description === 'string' && item.description.length > 10 && item.inputSchema),
        '每个工具都带描述与入参 schema（缺描述时模型只会瞎猜参数）',
    );

    // 17. locales 对齐（zh/en 键集合、空值、插值名）——一次性探针的常驻版
    console.log('\n17. 测试两端 locales 对齐');
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
    const { WORK_NAV_GROUPS } = await import('../app/utils/work-nav');
    const { WORK_SETTINGS_PAGES } = await import('../app/utils/work-settings');
    const navKeys = WORK_NAV_GROUPS.flatMap((group) => [group.titleKey, ...group.links.map((link) => link.labelKey)]);
    const settingsKeys = WORK_SETTINGS_PAGES.flatMap((page) => [page.labelKey, page.descKey]);
    const tableKeys = [...new Set([...navKeys, ...settingsKeys])];
    const missingTableKeys = tableKeys.filter((key) => !zhKeySet.has(key));
    assert(
        tableKeys.length >= 20 && missingTableKeys.length === 0,
        `导航与设置表引用的 ${tableKeys.length} 个动态键都在 locales 里存在（缺失：${missingTableKeys.join(', ') || '无'}）`,
    );

    // 图标名同样只在这两张表里写一次：名字拼错时 AppIcon 只画一个占位方框，没有任何报错
    const { APP_ICONS } = await import('../app/utils/app-icons');
    const tableIcons = [
        ...new Set([...WORK_NAV_GROUPS.flatMap((group) => group.links.map((link) => link.icon)), ...WORK_SETTINGS_PAGES.map((page) => page.icon)]),
    ];
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
    const deadTargets = [...WORK_NAV_GROUPS.flatMap((group) => group.links), ...WORK_SETTINGS_PAGES].filter((item) => !hasPage(item.to)).map((item) => item.to);
    assert(
        deadTargets.length === 0,
        `导航与设置表的 ${WORK_NAV_GROUPS.reduce((n, g) => n + g.links.length, 0) + WORK_SETTINGS_PAGES.length} 个目标都有页面文件（悬空：${deadTargets.join(', ') || '无'}）`,
    );

    // 18. 后台生成的回放缓冲（chat-runs）：切页面/刷新不打断生成，靠的就是这份内存副本
    console.log('\n18. 测试对话后台运行的回放缓冲');
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

    // 19. 数据库连通性与核心表（可选：本机未起数据库时跳过）
    console.log('\n19. 测试数据库连通性与核心数据表');
    try {
        const { sql } = await import('drizzle-orm');
        const { db } = await import('../server/utils/db');
        await db.execute(sql`SELECT 1`);
        assert(true, 'PostgreSQL 数据库连通正常');
        for (const [name, table] of [
            ['notes', schema.notes],
            ['schedules', schema.schedules],
            ['briefs', schema.briefs],
            ['agents', schema.agents],
        ] as const) {
            const [row] = await db.select({ count: sql<number>`count(*)` }).from(table);
            assert(Number(row?.count ?? 0) >= 0, `${name} 表可正常查询`);
        }
    } catch (e: any) {
        console.warn('  ⚠️ 数据库未运行或无法连接，跳过真实 DB 查询:', e?.message);
    }

    // 20. 前后端档位对账：work 的前端不 import 服务端，表单档位是抄一份的，
    //     抄漏一次的表现是「界面填得进、保存被 400」或反过来「服务端放宽了、表单还卡在旧值」，两边都不报错。
    console.log('\n20. 测试前后端档位常量一致');
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
