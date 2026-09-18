import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { membershipPlans } from '../../../db/schema';
import { invalidatePlansCache } from '../../../utils/billing';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

const PlanPatchSchema = z.object({
    name: z.string().min(1).max(50).optional(),
    description: z.string().max(500).optional(),
    chatQuotaPerDay: z.number().int().positive().nullable().optional(),
    monthlyPriceCents: z.number().int().min(0).optional(),
    yearlyPriceCents: z.number().int().min(0).nullable().optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
});

/** 编辑套餐 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id');
    if (!id) throw createError({ statusCode: 400, statusMessage: '缺少套餐 ID' });

    const body = (await readBody(event)) ?? {};
    const parsed = PlanPatchSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: `参数错误: ${parsed.error.issues[0]?.message ?? ''}` });
    }

    const [updated] = await db
        .update(membershipPlans)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(membershipPlans.id, id))
        .returning();

    if (!updated) {
        throw createError({ statusCode: 404, statusMessage: '套餐不存在' });
    }

    await invalidatePlansCache();
    return updated;
});
