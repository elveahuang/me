import { and, eq, ne } from 'drizzle-orm';
import { agents, knowledgeBases, providers } from '../../../db/schema';
import { normalizeAdminBoolean } from '../../../utils/admin-boolean';
import { normalizeProviderModels } from '../../../utils/admin-provider-input';
import { db } from '../../../utils/db';
import { requireMethod } from '../../../utils/method';
import { assertAbsoluteHttpUrl } from '../../../utils/outbound';
import { safeTrim, stripNull } from '../../../utils/pg-text';
import { ADMIN_BODY_LIMIT_BYTES, capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';
import { lockDefaultSlot } from '../../../utils/unique-default';

function maskKey(key: string) {
    if (!key) return '';
    return key.length <= 8 ? '****' : `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export default defineEventHandler(async (event) => {
    await capBody(event, ADMIN_BODY_LIMIT_BYTES);
    // GET 原本会落进下面的更新分支（readBody 得空对象 → 只推进 updatedAt），读一次就写一次库
    const method = requireMethod(event, ['PATCH', 'DELETE']);
    const id = routeId(event, 'id', '供应商');

    if (method === 'DELETE') {
        // 「读这行 → 删这行」要锁住目标行本身，而且删之前得问两件事（与 `storage/[id].ts` 的 DELETE 同一口径）：
        // - 它是默认供应商：`ensureDefaultProvider()` 只在整个表为空时才补默认行，删掉唯一那个默认之后
        //   平台就再也没有默认位，`resolveModel()` 会静默退到「第一个启用的供应商」——
        //   所有没显式指定供应商的智能体连同嵌入模型一起换了服务，用户只看到回答风格突变，
        //   而既有知识库分块的向量与新模型不可比，检索静默降级成 Bigram。
        // - 还有智能体或知识库指向它：两处外键都是 `onDelete: 'set null'`，PostgreSQL 不会拦，
        //   删完那些行就「不知道自己原本用哪个供应商」，知识库的嵌入端点尤其会被换成默认档。
        // 行上的 FOR UPDATE 同时挡住并发把别的行设成默认、以及并发新建指向它的智能体。
        await db.transaction(async (tx) => {
            const [locked] = await tx.select().from(providers).where(eq(providers.id, id)).for('update');
            if (!locked) throw createError({ statusCode: 404, statusMessage: '供应商不存在' });
            if (locked.isDefault) throw createError({ statusCode: 409, statusMessage: '默认供应商不可删除，请先将其他供应商设为默认' });
            const usedByAgent = await tx.select({ id: agents.id }).from(agents).where(eq(agents.providerId, id)).limit(1);
            if (usedByAgent.length) throw createError({ statusCode: 409, statusMessage: '仍有智能体使用该供应商，请先改为其他供应商' });
            const usedByKb = await tx.select({ id: knowledgeBases.id }).from(knowledgeBases).where(eq(knowledgeBases.embeddingProviderId, id)).limit(1);
            if (usedByKb.length) throw createError({ statusCode: 409, statusMessage: '仍有知识库使用该供应商做嵌入，请先改为其他供应商' });
            await tx.delete(providers).where(eq(providers.id, id));
        });
        return { ok: true };
    }

    const body = (await readBody(event)) ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    // 逐字段归一：非字符串/非布尔直写 text/boolean 列会被 PG 拒成 500 并透出 SQL 细节
    if (body.name !== undefined) {
        const name = safeTrim(body.name);
        if (!name) throw createError({ statusCode: 400, statusMessage: 'name 必填' });
        if (name.length > 100) throw createError({ statusCode: 400, statusMessage: 'name 过长（最多 100 字符）' });
        patch.name = name;
    }
    if (body.enabled !== undefined) patch.enabled = normalizeAdminBoolean(body.enabled, 'enabled', true);
    if (body.isDefault !== undefined) patch.isDefault = normalizeAdminBoolean(body.isDefault, 'isDefault', false);
    if (body.baseUrl !== undefined) patch.baseUrl = assertAbsoluteHttpUrl('baseUrl', body.baseUrl);
    if (body.models !== undefined) patch.models = normalizeProviderModels(body.models, 'reject');
    // apiKey 只有在明确传入新值时才更新。客户端会把 GET 回来的掩码原样发回来表示「不改」，
    // 这里只认「与当前密钥的掩码逐字相等」这一种情况：早先用 includes('****') 判断，
    // 真实密钥里恰好带这四个字符就会被静默跳过——用户以为换了 key，实际还在用旧的。
    const incomingKey = typeof body.apiKey === 'string' ? stripNull(body.apiKey) : '';
    if (incomingKey) {
        const [current] = await db.select({ apiKey: providers.apiKey }).from(providers).where(eq(providers.id, id));
        if (!current) throw createError({ statusCode: 404, statusMessage: '供应商不存在' });
        if (incomingKey !== maskKey(current.apiKey)) patch.apiKey = incomingKey;
    }

    const becomesDefault = patch.isDefault === true;
    await db.transaction(async (tx) => {
        // 提升为默认时先清掉其它默认，且与本行更新同事务，避免出现两个默认供应商。
        // 槽位锁管的是另一个方向：并发时两个事务各自的「清掉其它默认」都读不到对方尚未提交的那行，
        // 于是两行同时变成默认（表里本来没有默认行时尤其明显，见 unique-default.ts）。
        if (becomesDefault) {
            await lockDefaultSlot(tx, 'providers');
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
