import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { conversations } from '../../db/schema';
import { db } from '../../utils/db';
import { requireUser } from '../../utils/guard';

const PatchConversationSchema = z.object({
    title: z.string().min(1).max(100),
});

export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const id = getRouterParam(event, 'id')!;
    const body = (await readBody(event)) ?? {};

    const parsed = PatchConversationSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: '会话标题不能为空且不能超过 100 字符' });
    }

    const [existing] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.userId, session.user.id)));

    if (!existing) {
        throw createError({ statusCode: 404, statusMessage: '会话不存在' });
    }

    const [updated] = await db.update(conversations).set({ title: parsed.data.title, updatedAt: new Date() }).where(eq(conversations.id, id)).returning();

    return updated;
});
