import { and, eq, ne } from 'drizzle-orm';
import { providers } from '../../../db/schema';
import { normalizeAdminBoolean } from '../../../utils/admin-boolean';
import { normalizeProviderModels } from '../../../utils/admin-provider-input';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';
import { requireMethod } from '../../../utils/method';
import { assertAbsoluteHttpUrl } from '../../../utils/outbound';

function maskKey(key: string) {
    if (!key) return '';
    return key.length <= 8 ? '****' : `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    // GET 原本会落进下面的更新分支（readBody 得空对象 → 只推进 updatedAt），读一次就写一次库
    const method = requireMethod(event, ['PATCH', 'DELETE']);
    const id = getRouterParam(event, 'id')!;

    if (method === 'DELETE') {
        // 与 agents/[id].delete.ts 同口径：0 行影响要报 404，否则 id 抄错或已被别的管理员删掉时，
        // 界面照样提示「已删除」。
        const deleted = await db.delete(providers).where(eq(providers.id, id)).returning({ id: providers.id });
        if (!deleted.length) throw createError({ statusCode: 404, statusMessage: '供应商不存在' });
        return { ok: true };
    }

    const body = (await readBody(event)) ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    // 逐字段归一：非字符串/非布尔直写 text/boolean 列会被 PG 拒成 500 并透出 SQL 细节
    if (body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) throw createError({ statusCode: 400, statusMessage: 'name 必填' });
        if (name.length > 100) throw createError({ statusCode: 400, statusMessage: 'name 过长（最多 100 字符）' });
        patch.name = name;
    }
    if (body.enabled !== undefined) patch.enabled = normalizeAdminBoolean(body.enabled, 'enabled', true);
    if (body.isDefault !== undefined) patch.isDefault = normalizeAdminBoolean(body.isDefault, 'isDefault', false);
    if (body.baseUrl !== undefined) patch.baseUrl = assertAbsoluteHttpUrl('baseUrl', body.baseUrl);
    if (body.models !== undefined) patch.models = normalizeProviderModels(body.models, 'reject');
    // apiKey 只有在明确传入新值时才更新（掩码回传不覆盖真实 key）
    if (typeof body.apiKey === 'string' && body.apiKey && !body.apiKey.includes('****')) {
        patch.apiKey = body.apiKey;
    }

    const becomesDefault = patch.isDefault === true;
    await db.transaction(async (tx) => {
        // 提升为默认时先清掉其它默认，且与本行更新同事务，避免出现两个默认供应商。
        if (becomesDefault) {
            await tx
                .update(providers)
                .set({ isDefault: false, updatedAt: new Date() })
                .where(and(eq(providers.isDefault, true), ne(providers.id, id)));
        }
        // 0 行更新必须在事务内判掉：id 不存在时上面那批「清掉其它默认」的写已经提交，
        // 而请求回的是 404——运营看到的是「设默认失败」，平台却已经一个默认供应商都没有了。
        const updated = await tx.update(providers).set(patch).where(eq(providers.id, id)).returning({ id: providers.id });
        if (!updated.length) throw createError({ statusCode: 404, statusMessage: '供应商不存在' });
    });

    const [row] = await db.select().from(providers).where(eq(providers.id, id));
    // 提交后仍可能被并发删除：没有行就不要回一个 undefined 展开出来的空对象
    if (!row) throw createError({ statusCode: 404, statusMessage: '供应商不存在' });
    return { ...row, apiKey: maskKey(row.apiKey) };
});
