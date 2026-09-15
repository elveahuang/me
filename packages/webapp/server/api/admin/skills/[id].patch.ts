import { eq } from 'drizzle-orm';
import { skills } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;
    const body = await readBody(event);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['name', 'description', 'instructions', 'enabled'] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
    }
    await db.update(skills).set(patch).where(eq(skills.id, id));
    const [row] = await db.select().from(skills).where(eq(skills.id, id));
    return row;
});
