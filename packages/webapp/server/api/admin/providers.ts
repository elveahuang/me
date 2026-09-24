import { asc, eq } from 'drizzle-orm';
import { providers } from '../../db/schema';
import { normalizeAdminBoolean } from '../../utils/admin-boolean';
import { normalizeProviderModels } from '../../utils/admin-provider-input';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { requireMethod } from '../../utils/method';
import { assertAbsoluteHttpUrl } from '../../utils/outbound';
import { ensureDefaultProvider } from '../../utils/providers';

function maskKey(key: string) {
    if (!key) return '';
    return key.length <= 8 ? '****' : `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    // 其余方法（PUT/PATCH/DELETE）原本落进下面的读取分支：请求拿到 200 + 列表，看起来像写成功了
    const method = requireMethod(event, ['GET', 'POST']);

    if (method === 'POST') {
        const body = (await readBody(event)) ?? {};
        // 与 [id].ts 的 PATCH 用同一组归一规则：否则 POST 能建出带首尾空白的名称，
        // 非布尔的 enabled/isDefault 会被 PG 拒成 500 并透出 SQL 细节（models 是 jsonb，脏值不报错但会一路进模型上下文）
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) throw createError({ statusCode: 400, statusMessage: 'name 必填' });
        if (name.length > 100) throw createError({ statusCode: 400, statusMessage: 'name 过长（最多 100 字符）' });
        if (!body.baseUrl) {
            throw createError({ statusCode: 400, statusMessage: 'name 和 baseUrl 必填' });
        }
        const isDefault = normalizeAdminBoolean(body.isDefault, 'isDefault', false);
        const enabled = normalizeAdminBoolean(body.enabled, 'enabled', true);
        const models = body.models === undefined ? [] : normalizeProviderModels(body.models, 'reject');
        if (body.apiKey !== undefined && typeof body.apiKey !== 'string') {
            throw createError({ statusCode: 400, statusMessage: 'apiKey 必须为字符串' });
        }
        const baseUrl = assertAbsoluteHttpUrl('baseUrl', body.baseUrl);
        const id = crypto.randomUUID();
        // 设为默认要清除其它默认，且与本次插入同事务：否则中途失败会留下 0 个或 2 个默认供应商。
        await db.transaction(async (tx) => {
            if (isDefault) {
                await tx.update(providers).set({ isDefault: false, updatedAt: new Date() }).where(eq(providers.isDefault, true));
            }
            await tx.insert(providers).values({
                id,
                name,
                baseUrl,
                apiKey: body.apiKey ?? '',
                models,
                enabled,
                isDefault,
            });
        });
        const [row] = await db.select().from(providers).where(eq(providers.id, id));
        return { ...row!, apiKey: maskKey(row!.apiKey) };
    }

    await ensureDefaultProvider();
    const rows = await db.select().from(providers).orderBy(asc(providers.createdAt));
    return rows.map((p) => ({ ...p, apiKey: maskKey(p.apiKey) }));
});
