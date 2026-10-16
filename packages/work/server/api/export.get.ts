import { asc } from 'drizzle-orm';
import {
    agentKnowledgeBases,
    agentMcpServers,
    agentSkills,
    agentTools,
    agents,
    attachments,
    briefs,
    conversations,
    events,
    kbDocuments,
    knowledgeBases,
    mcpServers,
    messages,
    notes,
    projects,
    providers,
    skills,
    storageConfigs,
    systemSettings,
    tasks,
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
 * - `kb_chunks` 与 `notes.embedding`：向量是可再生的派生数据（重建索引即可），带进备份只会让文件
 *   按分块数 × 维度膨胀，而且换过嵌入模型后那些向量本来就不可比（见 utils/embedding 的维度口径）。
 * - `providers.api_key`、`storage_configs.secret_access_key`：备份文件是会被拷走、发出去的产物，
 *   把密钥一起写进去等于把「数据库泄露」升级成「备份泄露」。导出成空串，导入后在设置页重新填。
 * - 附件二进制：对象存储里的桶需要另行备份，这里只给元数据与 objectKey。
 *
 * 整份文件在内存里序列化且行数不封顶；单用户工作台的量级（几千条消息）远不到风险线，
 * 但**不要**把它挂进任何轮询或定时任务。
 */

/** 密钥字段在导出里一律折成空串，同时把这个决定写进 `redacted`，免得用户以为备份可直接还原 */
const REDACTED = ['providers.api_key', 'storage_configs.secret_access_key'];
const SKIPPED = ['kb_chunks（知识库分块与向量，导入后重新「重建索引」即可）', 'notes.embedding（同上，派生数据）', '附件二进制本体（对象存储的桶需另行备份）'];

/**
 * 每张表一个 builder：把排序、脱敏和表名写在同一行里。
 *
 * 不用「21 个 await 排成一排再按位置解构」——那种写法加一张表就要数一遍位置，
 * 数错一次不会报错，只会把 notes 的内容当成 tasks 写进备份文件。
 */
const builders = {
    systemSettings: async () => (await db.select().from(systemSettings))[0] ?? null,
    projects: () => db.select().from(projects).orderBy(asc(projects.createdAt)),
    tasks: () => db.select().from(tasks).orderBy(asc(tasks.createdAt)),
    notes: async () =>
        (await db.select().from(notes).orderBy(asc(notes.createdAt))).map((row) => ({
            ...row,
            // 值为 undefined 的键不会进 JSON（stringify 直接丢掉），所以备份文件里压根没有这三列
            embedding: undefined,
            embeddingModel: undefined,
            embeddingDim: undefined,
        })),
    events: () => db.select().from(events).orderBy(asc(events.startsAt)),
    briefs: () => db.select().from(briefs).orderBy(asc(briefs.briefDate)),
    providers: async () => (await db.select().from(providers).orderBy(asc(providers.name))).map((row) => ({ ...row, apiKey: '' })),
    skills: () => db.select().from(skills).orderBy(asc(skills.name)),
    tools: () => db.select().from(tools).orderBy(asc(tools.name)),
    mcpServers: () => db.select().from(mcpServers).orderBy(asc(mcpServers.name)),
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
