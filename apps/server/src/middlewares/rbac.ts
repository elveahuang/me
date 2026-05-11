import { createMiddleware } from 'hono/factory';
import { auth } from '../auth.js';

type AppEnv = {
    Variables: {
        user: typeof auth.$Infer.Session.user;
        session: typeof auth.$Infer.Session.session;
    };
};

export const requireRole = (allowedRoles: string[]) => {
    return createMiddleware<AppEnv>(async (c, next) => {
        const session = await auth.api.getSession({
            headers: c.req.raw.headers,
        });

        if (!session) {
            return c.json({ error: 'Unauthorized' }, 401);
        }

        const userRole = session.user.role || 'user';

        if (!allowedRoles.includes(userRole)) {
            return c.json({ error: 'Forbidden: Insufficient role' }, 403);
        }

        c.set('user', session.user);
        c.set('session', session.session);
        await next();
    });
};
