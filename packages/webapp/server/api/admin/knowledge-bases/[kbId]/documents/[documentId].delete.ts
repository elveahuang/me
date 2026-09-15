import { eq } from 'drizzle-orm';
import { kbDocuments } from '../../../../../db/schema';
import { db } from '../../../../../utils/db';
import { requireAdmin } from '../../../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const documentId = getRouterParam(event, 'documentId')!;
    await db.delete(kbDocuments).where(eq(kbDocuments.id, documentId));
    return { ok: true };
});
