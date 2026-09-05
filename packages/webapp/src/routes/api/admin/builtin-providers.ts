import { errorResponse, json, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { createFileRoute } from '@tanstack/react-router';

/** 告诉管理端哪些内置供应商可用（不暴露 key 本身） */
export const Route = createFileRoute('/api/admin/builtin-providers')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }) => {
                try {
                    await requireAdmin(request);
                    return json([
                        ...(process.env.DEEPSEEK_API_KEY ? [{ id: 'deepseek', label: '内置 DeepSeek' }] : []),
                        ...(process.env.OPENAI_API_KEY ? [{ id: 'openai', label: '内置 OpenAI' }] : []),
                    ]);
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
