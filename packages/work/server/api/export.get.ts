import { asc } from 'drizzle-orm';
import {
    agentKnowledgeBases,
    agentMcpServers,
    agentSkills,
    agentTools,
    agents,
    attachments,
    automationRuns,
    conversations,
    kbDocuments,
    knowledgeBases,
    mcpServers,
    messages,
    providers,
    schedules,
    skills,
    spaces,
    storageConfigs,
    systemSettings,
    tools,
} from '../db/schema';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { LOCAL_OWNER } from '../utils/owner';
import { rateLimit } from '../utils/rate-limit';
import { capBody } from '../utils/request-body';
import { shanghaiDateKey } from '../utils/work-day';

/**
 * 全量数据导出：`GET /api/export` → 一份 JSON 备份文件。
 *
 * 为什么本机应用尤其需要它：工作台的数据全在这台机器的 PostgreSQL 里，没有账号、没有云端副本，
 * 于是「换机器 / 重装 / 留一份自己的数据」只有两条路——要么会写 psql 的人自己 dump，要么丢数据。
 *
 * 三处刻意不带出：
 * - `kb_chunks`：向量是可再生的派生数据（重建索引即可），带进备份只会让文件
 *   按分块数 × 维度膨胀，而且换过嵌入模型后那些向量本来就不可比（见 utils/embedding 的维度口径）。
 * - `providers.api_key`、`storage_configs.secret_access_key`：备份文件是会被拷走、发出去的产物，
 *   把密钥一起写进去等于把「数据库泄露」升级成「备份泄露」。导出成空串，导入后在设置页重新填。
 * - `mcp_servers.headers` 与 `tools.config.headers`：同一件事的另两个藏处。MCP 的鉴权就是这组请求头
 *   （通常是 `Authorization: Bearer …`），HTTP 工具的 `config.headers` 同样由管理员钉死凭据；
 *   读接口两边都会打码（`utils/mcp` 的 `maskHeaders`、`settings/tools` 的脱敏），只有备份文件曾整份明文带走。
 *   头名留在 `redactedHeaders` 里，还原时知道要补哪几个键；URL/`config.url` 仍原样导出，那是端点不是凭据。
 * - 附件二进制：对象存储里的桶需要另行备份，这里只给元数据与 objectKey。
 *
 * 整份文件在内存里序列化且行数不封顶；单用户工作台的量级（几千条消息）远不到风险线，
 * 但**不要**把它挂进任何轮询或后台任务。
 */

/** 密钥字段在导出里一律折成空串，同时把这个决定写进 `redacted`，免得用户以为备份可直接还原 */
const REDACTED = ['providers.api_key', 'storage_configs.secret_access_key', 'mcp_servers.headers', 'tools.config.headers'];
const SKIPPED = ['kb_chunks（知识库分块与向量，导入后重新「重建索引」即可）', '附件二进制本体（对象存储的桶需另行备份）'];

/**
 * 把一组请求头折成空对象，但保留头名。
 *
 * 值不能留（`Authorization` 就是凭据本身），名字要留：还原的人得知道这条工具/服务器原先要求填哪几个头。
 * 形状不认识时（不是普通对象）只丢不改，宁可少脱一层也不能把用户的配置写成别的东西。
 */
function dropHeaderValues(headers: unknown): { headers: Record<string, string>; redactedHeaders: string[] } {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return { headers: {}, redactedHeaders: [] };
    return { headers: {}, redactedHeaders: Object.keys(headers as Record<string, unknown>).sort() };
}

/**
 * 每张表一个 builder：把排序、脱敏和表名写在同一行里。
 *
 * 不用「十几个 await 排成一排再按位置解构」——那种写法加一张表就要数一遍位置，
 * 数错一次不会报错，只会把一张表的内容当成另一张写进备份文件。
 */
const builders = {
    systemSettings: async () => (await db.select().from(systemSettings))[0] ?? null,
    spaces: () => db.select().from(spaces).orderBy(asc(spaces.createdAt)),
    schedules: () => db.select().from(schedules).orderBy(asc(schedules.createdAt)),
    automationRuns: () => db.select().from(automationRuns).orderBy(asc(automationRuns.startedAt)),
    providers: async () => (await db.select().from(providers).orderBy(asc(providers.name))).map((row) => ({ ...row, apiKey: '' })),
    skills: () => db.select().from(skills).orderBy(asc(skills.name)),
    tools: async () =>
        (await db.select().from(tools).orderBy(asc(tools.name))).map((row) => {
            const config = row.config && typeof row.config === 'object' && !Array.isArray(row.config) ? (row.config as Record<string, unknown>) : null;
            // 只摘 config.headers（HTTP 工具的凭据位），其它键（url / method / bodyTemplate / parameters）是配置不是密钥
            if (!config) return row;
            const { headers, redactedHeaders } = dropHeaderValues(config.headers);
            if (!redactedHeaders.length) return row;
            return { ...row, config: { ...config, headers }, redactedHeaders };
        }),
    mcpServers: async () =>
        (await db.select().from(mcpServers).orderBy(asc(mcpServers.name))).map((row) => {
            const { headers, redactedHeaders } = dropHeaderValues(row.headers);
            return { ...row, headers, redactedHeaders };
        }),
    agents: () => db.select().from(agents).orderBy(asc(agents.name)),
    agentSkills: () => db.select().from(agentSkills),
    agentTools: () => db.select().from(agentTools),
    agentMcpServers: () => db.select().from(agentMcpServers),
    agentKnowledgeBases: () => db.select().from(agentKnowledgeBases),
    knowledgeBases: () => db.select().from(knowledgeBases).orderBy(asc(knowledgeBases.name)),
    kbDocuments: () => db.select().from(kbDocuments).orderBy(asc(kbDocuments.createdAt)),
    conversations: () => db.select().from(conversations).orderBy(asc(conversations.createdAt)),
    messages: () => db.select().from(messages).orderBy(asc(messages.seq)),
    attachments: () => db.select().from(attachments).orderBy(asc(attachments.createdAt)),
    storageConfigs: async () => (await db.select().from(storageConfigs).orderBy(asc(storageConfigs.name))).map((row) => ({ ...row, secretAccessKey: '' })),
};

export default defineEventHandler(async (event) => {
    await capBody(event);
    requireMethod(event, ['GET']);

    const limited = await rateLimit(`export:${LOCAL_OWNER}`, 6, 60_000);
    if (!limited.ok) {
        throw createError({ statusCode: 429, statusMessage: `导出过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
    }

    const data: Record<string, unknown> = {};
    await Promise.all(
        Object.entries(builders).map(async ([key, build]) => {
            data[key] = await build();
        }),
    );

    setHeader(event, 'content-disposition', `attachment; filename="work-backup-${shanghaiDateKey()}.json"`);

    return {
        format: 'work.backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        redacted: REDACTED,
        skipped: SKIPPED,
        data,
    };
});
