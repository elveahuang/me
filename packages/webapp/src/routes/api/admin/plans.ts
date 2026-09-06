import { db } from '@/db';
import { errorResponse, HttpError, json, readJson, requireAdmin } from '@/lib/api';
import { listPlans } from '@/lib/billing';
import { corsMiddleware } from '@/lib/cors';
import { membershipPlans } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

type RouteParams = { request: Request };

const PlanSchema = z.object({
    code: z.string().regex(/^[a-z0-9_-]+$/i, '编码只能包含字母数字、- 和 _').max(30),
    name: z.string().min(1).max(50),
    description: z.string().max(500).default(''),
    chatQuotaPerDay: z.number().int().positive().nullable().default(null),
    monthlyPriceCents: z.number().int().min(0).default(0),
    yearlyPriceCents: z.number().int().min(0).nullable().default(null),
    enabled: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
});

/** 套餐管理：列表（含未上架）/ 新建 */
export const Route = createFileRoute('/api/admin/plans')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    return json(await listPlans(true));
                } catch (e) {
                    return errorResponse(e);
                }
            },
            POST: async ({ request }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const parsed = PlanSchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);
                    const [existing] = await db.select().from(membershipPlans).where(eq(membershipPlans.code, parsed.data.code));
                    if (existing) throw new HttpError(400, '套餐编码已存在');
                    // onConflictDoNothing 兜底并发重码（check-then-insert 竞态时 unique 约束触发 500 → 改为 400）
                    const [created] = await db.insert(membershipPlans).values(parsed.data).onConflictDoNothing({ target: membershipPlans.code }).returning();
                    if (!created) throw new HttpError(400, '套餐编码已存在');
                    return json(created, 201);
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
