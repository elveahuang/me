import { asc, eq } from 'drizzle-orm';
import { kbChunks, kbDocuments, knowledgeBases, providers } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    if (getMethod(event) === 'POST') {
        const body = await readBody(event);
        if (!body.name) {
            throw createError({ statusCode: 400, statusMessage: 'name 必填' });
        }
        const id = crypto.randomUUID();
        await db.insert(knowledgeBases).values({
            id,
            name: body.name,
            description: body.description ?? '',
            embeddingProviderId: body.embeddingProviderId ?? null,
            embeddingModel: body.embeddingModel ?? 'text-embedding-3-small',
        });
        const [row] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, id));
        return row;
    }

    const rows = await db.select().from(knowledgeBases).orderBy(asc(knowledgeBases.createdAt));
    const docRows = await db.select({ id: kbDocuments.id, kbId: kbDocuments.kbId, status: kbDocuments.status }).from(kbDocuments);
    const chunkRows = await db.select({ id: kbChunks.id, kbId: kbChunks.kbId }).from(kbChunks);
    const providerRows = await db.select({ id: providers.id, name: providers.name }).from(providers);

    return rows.map((kb) => ({
        ...kb,
        providerName: providerRows.find((p) => p.id === kb.embeddingProviderId)?.name,
        documentCount: docRows.filter((d) => d.kbId === kb.id).length,
        chunkCount: chunkRows.filter((c) => c.kbId === kb.id).length,
    }));
});
