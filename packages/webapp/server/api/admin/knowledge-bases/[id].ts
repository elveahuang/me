import { eq } from 'drizzle-orm';
import { knowledgeBases } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;

    if (getMethod(event) === 'DELETE') {
        await db.delete(knowledgeBases).where(eq(knowledgeBases.id, id));
        return { ok: true };
    }

    const body = await readBody(event);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['name', 'description', 'embeddingModel'] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
    }
    if (body.embeddingProviderId !== undefined) patch.embeddingProviderId = body.embeddingProviderId || null;
    await db.update(knowledgeBases).set(patch).where(eq(knowledgeBases.id, id));
    const [row] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, id));
    return row;
});
