import type { H3Event } from 'h3';
import { auth } from './auth';

export async function requireUser(event: H3Event) {
    const session = await auth.api.getSession({ headers: event.headers });
    if (!session) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    return session;
}

export async function requireAdmin(event: H3Event) {
    const session = await requireUser(event);
    if (session.user.role !== 'admin') {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
    }
    return session;
}
