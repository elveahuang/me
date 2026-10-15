import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { agents, conversations } from '../db/schema';
import { db } from '../utils/db';
import { stripNull } from '../utils/pg-text';
import { capBody, readCappedJsonBody } from '../utils/request-body';

// 与重命名接口 [id].patch.ts 保持一致的标题约束：可选、非空时 ≤100 字符。
// 不做校验会让数组/对象直接进入 insert 参数（postgres-js 展开成标量后 500），或写入超长标题撑爆列表展示。
// stripNull 放在长度校验之后：U+0000 会让整条 INSERT 失败并把 SQL 原文回给界面。
const CreateConversationSchema = z.object({
    agentId: z.string().min(1).transform(stripNull),
    title: z.string().trim().max(100).transform(stripNull).optional(),
});

export default defineEventHandler(async (event) => {
    await capBody(event);
    const body = (await readCappedJsonBody<Record<string, unknown>>(event)) ?? {};

    const parsed = CreateConversationSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: 'agentId 必填，会话标题不能超过 100 字符' });
    }
    const { agentId, title } = parsed.data;

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent || !agent.enabled) {
        throw createError({ statusCode: 404, statusMessage: '智能体不存在' });
    }

    const id = crypto.randomUUID();
    await db.insert(conversations).values({
        id,
        agentId,
        title: title || '新对话',
    });
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
    return row;
});
