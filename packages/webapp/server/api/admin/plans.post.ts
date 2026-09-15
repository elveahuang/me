import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { membershipPlans } from '../../db/schema';
import { invalidatePlansCache } from '../../utils/billing';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';

const PlanSchema = z.object({
    code: z
        .string()
        .regex(/^[a-z0-9_-]+$/i, '编码只能包含字母数字、- 和 _')
        .max(30),
    name: z.string().min(1).max(50),
    description: z.string().max(500).default(''),
    chatQuotaPerDay: z.number().int().positive().nullable().default(null),
    monthlyPriceCents: z.number().int().min(0).default(0),
    yearlyPriceCents: z.number().int().min(0).nullable().default(null),
    enabled: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
});

/** 新建套餐 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const body = await readBody(event);
    const parsed = PlanSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: `参数错误: ${parsed.error.issues[0]?.message ?? ''}` });
    }

    const [existing] = await db.select().from(membershipPlans).where(eq(membershipPlans.code, parsed.data.code));
    if (existing) {
        throw createError({ statusCode: 400, statusMessage: '套餐编码已存在' });
    }

    const [created] = await db
        .insert(membershipPlans)
        .values({
            id: crypto.randomUUID(),
            ...parsed.data,
        })
        .onConflictDoNothing({ target: membershipPlans.code })
        .returning();

    if (!created) {
        throw createError({ statusCode: 400, statusMessage: '套餐编码已存在' });
    }

    await invalidatePlansCache();
    setResponseStatus(event, 201);
    return created;
});
