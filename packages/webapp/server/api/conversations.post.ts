import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { agents, conversations } from '../db/schema';
import { db } from '../utils/db';
import { requireUser } from '../utils/guard';

// 与重命名接口 [id].patch.ts 保持一致的标题约束：可选、非空时 ≤100 字符。
// 不做校验会让数组/对象直接进入 insert 参数（postgres-js 展开成标量后 500），或写入超长标题撑爆列表展示。
const CreateConversationSchema = z.object({
    agentId: z.string().min(1),
    title: z.string().trim().max(100).optional(),
});

export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const body = (await readBody(event)) ?? {};

    const parsed = CreateConversationSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: 'agentId 必填，会话标题不能超过 100 字符' });
    }
    const { agentId, title } = parsed.data;

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent || !agent.enabled) {
        throw createError({ statusCode: 404, statusMessage: 'Agent not found' });
    }

    const id = crypto.randomUUID();
    await db.insert(conversations).values({
        id,
        userId: session.user.id,
        agentId,
        title: title || '新对话',
    });
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
    return row;
});
