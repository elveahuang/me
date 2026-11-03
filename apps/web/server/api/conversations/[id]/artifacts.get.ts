import { desc, eq } from 'drizzle-orm';
import { artifacts } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireMethod } from '../../../utils/method';
import { routeId } from '../../../utils/route-id';

/** `GET /api/conversations/{id}/artifacts`：当前会话的交付物元数据，按登记时间倒序。 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    const conversationId = routeId(event, 'id', '会话');
    const rows = await db
        .select({
            id: artifacts.id,
            title: artifacts.title,
            path: artifacts.path,
            mimeType: artifacts.mimeType,
            size: artifacts.size,
            createdAt: artifacts.createdAt,
        })
        .from(artifacts)
        .where(eq(artifacts.conversationId, conversationId))
        .orderBy(desc(artifacts.createdAt))
        .limit(200);
    return { artifacts: rows };
});
