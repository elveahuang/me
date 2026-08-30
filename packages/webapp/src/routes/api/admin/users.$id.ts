import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { user } from '@schema';
import { errorResponse, HttpError, json, readJson, requireAdmin } from '@/lib/api';

type RouteParams = { request: Request; params: { id: string } };

const UserPatchSchema = z.object({
    role: z.enum(['user', 'admin']).optional(),
    banned: z.boolean().optional(),
    banReason: z.string().max(200).optional(),
});

/** 更新用户角色 / 封禁状态（用户 ID 为文本，不可操作自己） */
export const Route = createFileRoute('/api/admin/users/$id')({
    server: {
        handlers: {
            PATCH: async ({ request, params }: RouteParams) => {
                try {
                    const adminSession = await requireAdmin(request);
                    const id = params.id;
                    if (id === adminSession.user.id) throw new HttpError(400, '不能修改自己的状态');

                    const parsed = UserPatchSchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);

                    const [updated] = await db
                        .update(user)
                        .set({
                            ...(parsed.data.role ? { role: parsed.data.role } : {}),
                            ...(parsed.data.banned === undefined
                                ? {}
                                : {
                                      banned: parsed.data.banned,
                                      banReason: parsed.data.banned ? (parsed.data.banReason ?? '违规使用') : null,
                                  }),
                            updatedAt: new Date(),
                        })
                        .where(eq(user.id, id))
                        .returning({
                            id: user.id,
                            name: user.name,
                            email: user.email,
                            role: user.role,
                            banned: user.banned,
                            banReason: user.banReason,
                        });
                    if (!updated) throw new HttpError(404, '用户不存在');
                    return json(updated);
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
