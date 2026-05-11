import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { auth } from './auth.js';
import { requireRole } from './middlewares/rbac.js';

export type AppEnv = {
    Variables: {
        user: typeof auth.$Infer.Session.user;
        session: typeof auth.$Infer.Session.session;
    };
};

const app = new Hono<AppEnv>();

app.get('/', (c) => {
    return c.text('Hello Hono with Better-Auth & Drizzle!');
});

// Better-Auth handler for authentication endpoints (e.g., /api/auth/sign-in)
app.on(['POST', 'GET'], '/api/auth/*', (c) => {
    return auth.handler(c.req.raw);
});

// Basic RBAC protected routes
app.get('/api/admin', requireRole(['admin']), (c) => {
    const user = c.get('user');
    return c.json({ message: `Welcome admin ${user?.name}`, user });
});

app.get('/api/user', requireRole(['admin', 'user']), (c) => {
    const user = c.get('user');
    return c.json({ message: `Welcome user ${user?.name}`, user });
});

serve(
    {
        fetch: app.fetch,
        port: 3000,
    },
    (info) => {
        console.log(`Server is running on http://localhost:${info.port}`);
    },
);
