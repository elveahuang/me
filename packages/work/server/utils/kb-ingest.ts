import { eq } from 'drizzle-orm';
import { createError } from 'h3';
import { attachments, kbChunks, kbDocuments, knowledgeBases, providers } from '../db/schema';
import { db } from './db';
import { chunkText, embedTexts, INDEX_EMBED_BUDGET_MS } from './embedding';
import { stripNull } from './pg-text';
import { openSecret } from './secret-box';
import { getObject, resolveStoredStorageConfig } from './storage';

export const MAX_KB_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const KB_DOCUMENT_TITLE_MAX = 200;
const EMBED_BATCH_SIZE = 16;
const INSERT_BATCH_SIZE = 200;

const TEXT_EXTENSIONS =
    /\.(txt|md|markdown|json|jsonl|csv|tsv|yaml|yml|xml|html|htm|css|scss|js|jsx|ts|tsx|mjs|cjs|vue|py|rb|go|rs|java|kt|c|cpp|h|hpp|cs|php|sql|sh|bash|ps1|toml|ini|conf|log|env)$/i;

const TEXT_MIME_PREFIXES = [
    'text/',
    'application/json',
    'application/ld+json',
    'application/xml',
    'application/javascript',
    'application/x-javascript',
    'application/typescript',
    'application/x-yaml',
    'application/yaml',
    'application/toml',
    'application/sql',
    'application/csv',
    'application/x-sh',
];

/** 判断附件是否为可直接按 UTF-8 读取正文的文本/代码文件 */
export function isTextLikeAttachment(filename: string, mimeType: string): boolean {
    const mime = (mimeType || '').toLowerCase().trim();
    if (TEXT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) return true;
    return TEXT_EXTENSIONS.test((filename || '').trim());
}

/** 从 S3 对象流中按上限读取字节到 Buffer（超出 maxBytes 时截断或抛错） */
export async function readAttachmentBuffer(
    attachmentId: string,
    maxBytes: number,
    truncateOnOverflow = false,
): Promise<{ row: typeof attachments.$inferSelect; buffer: Buffer; truncated: boolean }> {
    const [row] = await db.select().from(attachments).where(eq(attachments.id, attachmentId));
    if (!row) {
        throw createError({ statusCode: 404, statusMessage: '附件不存在' });
    }
    const config = await resolveStoredStorageConfig(row.storageConfigId);
    const object = await getObject(config, row.objectKey);
    const stream = object.Body as unknown as AsyncIterable<Uint8Array> | undefined;
    if (!stream) {
        throw createError({ statusCode: 502, statusMessage: '对象存储未返回文件内容' });
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    for await (const chunk of stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (total + buf.length > maxBytes) {
            if (!truncateOnOverflow) {
                throw createError({ statusCode: 400, statusMessage: `文件体积超过限制（最多 ${Math.round(maxBytes / 1024)}KB）` });
            }
            const remain = maxBytes - total;
            if (remain > 0) chunks.push(buf.subarray(0, remain));
            total = maxBytes;
            truncated = true;
            break;
        }
        chunks.push(buf);
        total += buf.length;
    }

    return { row, buffer: Buffer.concat(chunks, total), truncated };
}

/** 将标题与纯文本内容切块、向量化并写入指定知识库（带事务保证） */
export async function ingestDocumentIntoKb(params: { kbId: string; title: string; content: string }): Promise<{
    id: string;
    kbId: string;
    title: string;
    content: string;
    chunkCount: number;
    status: string;
    createdAt: Date;
    provider: string;
}> {
    const [kb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, params.kbId));
    if (!kb) throw createError({ statusCode: 404, statusMessage: '知识库不存在' });

    const cleanTitle = stripNull(params.title || '').trim() || '未命名文档';
    if (cleanTitle.length > KB_DOCUMENT_TITLE_MAX) {
        throw createError({ statusCode: 400, statusMessage: `文档标题 过长（最多 ${KB_DOCUMENT_TITLE_MAX} 字符）` });
    }

    const cleanContent = stripNull(params.content || '');
    if (Buffer.byteLength(cleanContent, 'utf-8') > MAX_KB_DOCUMENT_BYTES) {
        throw createError({ statusCode: 400, statusMessage: '文档内容超过 2MB 限制' });
    }
    if (!cleanContent.trim()) {
        throw createError({ statusCode: 400, statusMessage: '文档内容为空' });
    }

    let provider = undefined;
    if (kb.embeddingProviderId) {
        const [row] = await db.select().from(providers).where(eq(providers.id, kb.embeddingProviderId));
        if (row) provider = { ...row, apiKey: openSecret(row.apiKey) };
    }
    if (!provider) {
        const rows = (await db.select().from(providers).where(eq(providers.enabled, true))).map((row) => ({ ...row, apiKey: openSecret(row.apiKey) }));
        provider = rows.find((p) => p.isDefault) ?? rows[0];
    }

    const chunks = chunkText(cleanContent);
    let vectors: number[][] = [];
    const providerName = provider?.name ?? '离线 Bigram 索引';

    if (provider) {
        const embedDeadline = AbortSignal.timeout(INDEX_EMBED_BUDGET_MS);
        for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
            const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
            if (embedDeadline.aborted) {
                while (vectors.length < chunks.length) vectors.push([]);
                break;
            }
            try {
                const batchVectors = await embedTexts(provider, kb.embeddingModel, batch, embedDeadline);
                batch.forEach((_, j) => vectors.push(batchVectors[j] ?? []));
            } catch {
                batch.forEach(() => vectors.push([]));
            }
        }
    } else {
        vectors = chunks.map(() => []);
    }

    const docId = crypto.randomUUID();
    await db.transaction(async (tx) => {
        await tx.insert(kbDocuments).values({
            id: docId,
            kbId: kb.id,
            title: cleanTitle,
            content: cleanContent,
            chunkCount: chunks.length,
            status: 'ready',
        });
        for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
            const batch = chunks.slice(i, i + INSERT_BATCH_SIZE);
            await tx.insert(kbChunks).values(
                batch.map((content_, j) => ({
                    id: crypto.randomUUID(),
                    kbId: kb.id,
                    documentId: docId,
                    content: content_,
                    embedding: vectors[i + j] ?? [],
                    embeddingV: (vectors[i + j]?.length ?? 0) === 1536 ? vectors[i + j] : null,
                })),
            );
        }
    });

    const [row] = await db.select().from(kbDocuments).where(eq(kbDocuments.id, docId));
    return { ...row!, provider: providerName };
}
