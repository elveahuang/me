import { and, desc, eq } from 'drizzle-orm';
import { approvals, type ApprovalStatus } from '../db/schema';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { intParam } from '../utils/query';
import { capBody } from '../utils/request-body';

export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    await capBody(event);
    const query = getQuery(event);
    const conversationId = typeof query.conversationId === 'string' ? query.conversationId.trim() : '';
    const status = (typeof query.status === 'string' && query.status ? query.status : 'pending') as ApprovalStatus;
    const limit = intParam(query.limit, 50, 1, 100);

    const where = conversationId ? and(eq(approvals.status, status), eq(approvals.conversationId, conversationId)) : eq(approvals.status, status);
    const rows = await db.select().from(approvals).where(where).orderBy(desc(approvals.createdAt)).limit(limit);
    return { approvals: rows };
});
