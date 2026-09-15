import { eq } from 'drizzle-orm';
import { tools } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;
    await db.delete(tools).where(eq(tools.id, id));
    return { ok: true };
});
