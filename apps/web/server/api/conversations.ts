import { and, desc, eq } from 'drizzle-orm';
import type { H3Event } from 'h3';
import { z } from 'zod';
import { agents, conversations, spaces } from '../db/schema';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { stripNull } from '../utils/pg-text';
import { intParam, stringParam } from '../utils/query';
import { lockAgentRow } from '../utils/ref-lock';
import { capBody, readCappedJsonBody } from '../utils/request-body';
import { resolveOptionalSpaceId } from '../utils/spaces';

// 与重命名接口 [id] 保持一致的标题约束：可选、非空时 ≤100 字符。
// 不做校验会让数组/对象直接进入 insert 参数（postgres-js 展开成标量后 500），或写入超长标题撑爆列表展示。
// stripNull 放在长度校验之后：U+0000 会让整条 INSERT 失败并把 SQL 原文回给界面。
const CreateConversationSchema = z.object({
    agentId: z.string().min(1).transform(stripNull),
    title: z.string().trim().max(100).transform(stripNull).optional(),
    spaceId: z.string().trim().max(36).optional(),
});

async function createConversation(event: H3Event) {
    const body = (await readCappedJsonBody<Record<string, unknown>>(event)) ?? {};

    const parsed = CreateConversationSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: 'agentId 必填，会话标题不能超过 100 字符' });
    }
    const { agentId, title } = parsed.data;
    const spaceId = await resolveOptionalSpaceId(parsed.data.spaceId);

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent || !agent.enabled) {
        throw createError({ statusCode: 404, statusMessage: '智能体不存在' });
    }

    const id = crypto.randomUUID();
    // 上面那次读只是快路径（把「未启用」也一并挡在事务外）。存在性判定必须在事务内重做一次
    // 并对父行取锁：从这次读到下面 INSERT 之间，另一个标签页可以完整地删掉该智能体
    // （settings/agents/[id].ts 的 DELETE 会对该行取 FOR UPDATE），于是这条 INSERT 撞 23503，
    // 用户看到的是 500 + 整张列清单，而会话其实一条都没建。
    await db.transaction(async (tx) => {
        await lockAgentRow(tx, agentId);
        await tx.insert(conversations).values({
            id,
            agentId,
            spaceId,
            title: title || '新对话',
        });
    });
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
    return row;
}

export default defineEventHandler(async (event) => {
    const method = requireMethod(event, ['GET', 'POST']);
    await capBody(event);
    if (method === 'POST') return createConversation(event);

    const query = getQuery(event);
    // 重复参数会给数组，数组进 eq() 被 postgres-js 展开成标量参数 → 500 + SQL 细节外泄；
    // 上一版只做了 `typeof === 'string'` 判定，于是数组形态降级成「不按智能体筛」，
    // 用户要 A 智能体的会话却拿回全部会话，且没有任何提示。stringParam 取第一个，照筛选走。
    const agentId = stringParam(query.agentId);
    const requestedSpaceId = stringParam(query.spaceId);
    const spaceId = requestedSpaceId ? await resolveOptionalSpaceId(requestedSpaceId) : null;
    // 分页参数必须夹在合法区间并取整：负数会让 PostgreSQL 直接报错（2201W/2201X）
    // 并把 SQL 细节透出到响应体，NaN 也会让 offset 变成 NULL 语义，小数则会被拒绝（22P02）
    const limit = intParam(query.limit, 50, 1, 200);
    // 上界 1e12：原表达式没有 Math.min，?offset=1e300 会原样进 SQL 撞 22003；
    // 1e12 远超任何合法分页量级，也不溢出 PG 的 int8
    const offset = intParam(query.offset, 0, 0, 1e12);

    const rows = await db
        .select({
            id: conversations.id,
            title: conversations.title,
            agentId: conversations.agentId,
            agentName: agents.name,
            agentEmoji: agents.emoji,
            spaceId: conversations.spaceId,
            spaceName: spaces.name,
            updatedAt: conversations.updatedAt,
        })
        .from(conversations)
        .innerJoin(agents, eq(agents.id, conversations.agentId))
        .leftJoin(spaces, eq(spaces.id, conversations.spaceId))
        .where(
            agentId && spaceId
                ? and(eq(conversations.agentId, agentId), eq(conversations.spaceId, spaceId))
                : agentId
                  ? eq(conversations.agentId, agentId)
                  : spaceId
                    ? eq(conversations.spaceId, spaceId)
                    : undefined,
        )
        .orderBy(desc(conversations.updatedAt))
        .limit(limit)
        .offset(offset);
    return rows;
});
