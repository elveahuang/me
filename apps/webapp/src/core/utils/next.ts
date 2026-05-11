import { toNextJsHandler } from 'better-auth/next-js';

export type NextJsHandler = ReturnType<typeof toNextJsHandler>;

export function addCorsHeaders(req: Request, headers: Headers): void {
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Headers', 'authorization, content-type');
    headers.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=15, stale-if-error=86400');
}

export function withCors(handler: Function): (req: Request) => Promise<Response> {
    return async (req: Request): Promise<Response> => {
        const res: Response = await handler(req);
        addCorsHeaders(req, res.headers);
        return res;
    };
}
