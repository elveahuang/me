import { asc, eq } from 'drizzle-orm';
import { providers } from '../../db/schema';
import { normalizeAdminBoolean } from '../../utils/admin-boolean';
import { normalizeProviderModels } from '../../utils/admin-provider-input';
import { db } from '../../utils/db';
import { requireMethod } from '../../utils/method';
import { assertAbsoluteHttpUrl } from '../../utils/outbound';
import { safeTrim, stripNull } from '../../utils/pg-text';
import { ensureDefaultProvider } from '../../utils/providers';
import { ADMIN_BODY_LIMIT_BYTES, capBody } from '../../utils/request-body';
import { openSecret, sealSecret } from '../../utils/secret-box';
import { lockDefaultSlot } from '../../utils/unique-default';

function maskKey(key: string) {
    const plain = openSecret(key);
    if (!plain) return '';
    return plain.length <= 8 ? '****' : `${plain.slice(0, 4)}****${plain.slice(-4)}`;
}

export default defineEventHandler(async (event) => {
    await capBody(event, ADMIN_BODY_LIMIT_BYTES);

    // 其余方法（PUT/PATCH/DELETE）原本落进下面的读取分支：请求拿到 200 + 列表，看起来像写成功了
    const method = requireMethod(event, ['GET', 'POST']);

    if (method === 'POST') {
        const body = (await readBody(event)) ?? {};
        // 与 [id].ts 的 PATCH 用同一组归一规则：否则 POST 能建出带首尾空白的名称，
        // 非布尔的 enabled/isDefault 会被 PG 拒成 500 并透出 SQL 细节（models 是 jsonb，脏值不报错但会一路进模型上下文）
        const name = safeTrim(body.name);
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
        // 同事务还不够：并发进来另一个「设为默认」时，两边都看不到对方尚未提交的默认行，
        // 各自清完再各插各的 → 两个默认。用槽位锁把「清 + 写」串起来（见 unique-default.ts）。
        await db.transaction(async (tx) => {
            if (isDefault) {
                await lockDefaultSlot(tx, 'providers');
                await tx.update(providers).set({ isDefault: false, updatedAt: new Date() }).where(eq(providers.isDefault, true));
            }
            await tx.insert(providers).values({
                id,
                name,
                baseUrl,
                apiKey: body.apiKey === undefined ? '' : sealSecret(stripNull(body.apiKey as string)),
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
