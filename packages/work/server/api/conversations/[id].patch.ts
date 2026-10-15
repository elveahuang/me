import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { conversations } from '../../db/schema';
import { db } from '../../utils/db';
import { stripNull } from '../../utils/pg-text';
import { capBody, readCappedJsonBody } from '../../utils/request-body';

const PatchConversationSchema = z.object({
    // 标题里带 U+0000 会让这条 UPDATE 连 SQL 一起 500（jsonb/text 列都不接受它）
    // trim 必须排在 min 之前：`title='   '` 原本按长度 3 通过校验并写库，
    // 而 chat.post 的自动改名只看 `!row.title`（空串），一个全空白的标题是 truthy——
    // 于是侧栏永久留一条看不见名字的会话，用户既读不出它也认不出它。
    title: z.string().trim().min(1).max(100).transform(stripNull),
});

export default defineEventHandler(async (event) => {
    await capBody(event);
    const id = getRouterParam(event, 'id')!;
    const body = (await readCappedJsonBody<Record<string, unknown>>(event)) ?? {};

    const parsed = PatchConversationSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: '会话标题不能为空且不能超过 100 字符' });
    }

    const [existing] = await db.select().from(conversations).where(eq(conversations.id, id));

    if (!existing) {
        throw createError({ statusCode: 404, statusMessage: '会话不存在' });
    }

    const [updated] = await db.update(conversations).set({ title: parsed.data.title, updatedAt: new Date() }).where(eq(conversations.id, id)).returning();

    return updated;
});
