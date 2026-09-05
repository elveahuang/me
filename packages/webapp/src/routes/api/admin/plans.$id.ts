import { db } from '@/db';
import { errorResponse, HttpError, json, parseId, readJson, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { membershipPlans, orders } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

type RouteParams = { request: Request; params: { id: string } };

const PlanPatchSchema = z.object({
    name: z.string().min(1).max(50).optional(),
    description: z.string().max(500).optional(),
    chatQuotaPerDay: z.number().int().positive().nullable().optional(),
    monthlyPriceCents: z.number().int().min(0).optional(),
    yearlyPriceCents: z.number().int().min(0).nullable().optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
});

/** 套餐管理：编辑 / 删除（有订单引用时禁止删除，可下架） */
export const Route = createFileRoute('/api/admin/plans/$id')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            PATCH: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, '套餐 ID');
                    const parsed = PlanPatchSchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);
                    const [updated] = await db
                        .update(membershipPlans)
                        .set({ ...parsed.data, updatedAt: new Date() })
                        .where(eq(membershipPlans.id, id))
                        .returning();
                    if (!updated) throw new HttpError(404, '套餐不存在');
                    return json(updated);
                } catch (e) {
                    return errorResponse(e);
                }
            },
            DELETE: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, '套餐 ID');
                    const [referenced] = await db.select({ id: orders.id }).from(orders).where(eq(orders.planId, id)).limit(1);
                    if (referenced) throw new HttpError(400, '该套餐已有订单记录，请改为下架（enabled=false）');
                    const deleted = await db.delete(membershipPlans).where(eq(membershipPlans.id, id)).returning({ id: membershipPlans.id });
                    if (deleted.length === 0) throw new HttpError(404, '套餐不存在');
                    return json({ ok: true });
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
