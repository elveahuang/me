import { eq } from 'drizzle-orm';
import { agents } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;
    await db.delete(agents).where(eq(agents.id, id));
    return { ok: true };
});
