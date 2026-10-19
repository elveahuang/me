import { and, asc, count, eq, sql } from 'drizzle-orm';
import { createError } from 'h3';
import { kbChunks, knowledgeBases, providers } from '../db/schema';
import { db } from './db';
import { embedTexts, INDEX_EMBED_BUDGET_MS } from './embedding';

/**
 * 知识库向量重建的后台任务（P3-3）。
 *
 * 原先 [reindex.ts] 在请求里同步跑完整库：一个几万块的知识库会让这个 POST 挂上几分钟，
 * 浏览器超时、Nitro 连接占满，而且界面拿不到「已经处理到哪」——只能等一个最终数字。
 * 现在把执行搬到进程内任务表：POST 立即返回 202 + 快照，前台轮询 GET 看 progress。
 *
 * 边界：
 * - 任务表是进程内的，重启即丢；知识库数据本身仍安全，重新发起即可（幂等覆盖向量）。
 * - 同一知识库只允许一个任务；不同知识库可以并行（但每个都受同一个嵌入总预算约束）。
 * - 只把「失败」限制在任务粒度：批级嵌入失败继续下一页，最终 `failed`/`lastError` 说明部分失败。
 * - 后台 Promise 必须自带 catch，否则 rejection 会撞上 `plugins/error-guard.ts` 直接退出进程。
 */

const EMBED_BATCH_SIZE = 16;
const SCAN_PAGE_SIZE = 200;
const JOB_RETENTION_MS = 60 * 60 * 1000;

export type KbReindexStatus = 'running' | 'completed' | 'failed';

export interface KbReindexJobSnapshot {
    kbId: string;
    kbName: string;
    status: KbReindexStatus;
    ok: boolean;
    total: number;
    processed: number;
    updated: number;
    failed: number;
    lastError: string | null;
    provider: string | null;
    startedAt: string;
    finishedAt: string | null;
}

type KbReindexJob = KbReindexJobSnapshot;

const jobs = new Map<string, KbReindexJob>();

function snapshot(job: KbReindexJob): KbReindexJobSnapshot {
    return { ...job };
}

function errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function failJob(job: KbReindexJob, error: unknown): void {
    job.status = 'failed';
    job.ok = false;
    job.lastError = errorMessage(error);
    job.finishedAt = new Date().toISOString();
    console.error(`[kb-reindex] 任务失败（kb=${job.kbId}）:`, error);
}

function sweep(now: number): void {
    for (const [kbId, job] of jobs) {
        if (job.status === 'running') continue;
        const finished = job.finishedAt ? Date.parse(job.finishedAt) : now;
        if (Number.isFinite(finished) && now - finished > JOB_RETENTION_MS) jobs.delete(kbId);
    }
}

async function resolveTarget(kbId: string) {
    const [kb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId));
    if (!kb) throw createError({ statusCode: 404, statusMessage: '知识库不存在' });

    let provider = undefined;
    if (kb.embeddingProviderId) {
        [provider] = await db.select().from(providers).where(eq(providers.id, kb.embeddingProviderId));
    }
    if (!provider) {
        const rows = await db.select().from(providers).where(eq(providers.enabled, true));
        provider = rows.find((p) => p.isDefault) ?? rows[0];
    }
    if (!provider) {
        throw createError({ statusCode: 400, statusMessage: '没有可用的嵌入供应商，请先在「模型供应商」中配置' });
    }
    return { kb, provider };
}

async function writeEmbeddings(rows: { id: string; embedding: number[] }[]) {
    if (!rows.length) return;
    await db.execute(sql`
        update ${kbChunks} as t
        set embedding = v.embedding
        from (values ${sql.join(
            rows.map((r) => sql`(${r.id}::text, ${JSON.stringify(r.embedding)}::jsonb)`),
            sql`, `,
        )}) as v(id, embedding)
        where t.id = v.id
    `);
}

async function execute(job: KbReindexJob, target: Awaited<ReturnType<typeof resolveTarget>>): Promise<void> {
    const { kb, provider } = target;
    const [totalRow] = await db.select({ n: count() }).from(kbChunks).where(eq(kbChunks.kbId, kb.id));
    job.total = Number(totalRow?.n ?? 0);

    const embedDeadline = AbortSignal.timeout(INDEX_EMBED_BUDGET_MS);
    let outOfBudget = false;
    let cursor: { createdAt: string; id: string } | null = null;

    while (!outOfBudget) {
        const conditions = [eq(kbChunks.kbId, kb.id)];
        if (cursor) conditions.push(sql`(${kbChunks.createdAt}, ${kbChunks.id}) > (${cursor.createdAt}::timestamp, ${cursor.id}::text)`);

        const page = await db
            .select({
                id: kbChunks.id,
                content: kbChunks.content,
                createdAtKey: sql<string>`to_char(${kbChunks.createdAt}, 'YYYY-MM-DD HH24:MI:SS.US')`,
            })
            .from(kbChunks)
            .where(and(...conditions))
            .orderBy(asc(kbChunks.createdAt), asc(kbChunks.id))
            .limit(SCAN_PAGE_SIZE);
        if (!page.length) break;

        cursor = { createdAt: page[page.length - 1]!.createdAtKey, id: page[page.length - 1]!.id };

        for (let i = 0; i < page.length; i += EMBED_BATCH_SIZE) {
            if (embedDeadline.aborted) {
                outOfBudget = true;
                break;
            }
            const batch = page.slice(i, i + EMBED_BATCH_SIZE);
            try {
                const vectors = await embedTexts(
                    provider,
                    kb.embeddingModel,
                    batch.map((c) => c.content),
                    embedDeadline,
                );
                const rows: { id: string; embedding: number[] }[] = [];
                for (let j = 0; j < batch.length; j++) {
                    const vector = vectors[j];
                    if (!vector?.length) {
                        job.failed++;
                        continue;
                    }
                    rows.push({ id: batch[j]!.id, embedding: vector });
                }
                await writeEmbeddings(rows);
                job.updated += rows.length;
            } catch (error) {
                console.error(`[kb-reindex] 批次失败（kb=${kb.id} after=${batch[batch.length - 1]?.id}）:`, error);
                job.failed += batch.length;
                job.lastError = errorMessage(error);
            }
            job.processed += batch.length;
        }

        if (outOfBudget || page.length < SCAN_PAGE_SIZE) break;
    }

    if (outOfBudget) {
        const remaining = Math.max(0, job.total - job.updated - job.failed);
        job.failed += remaining;
        job.processed = job.total;
        job.lastError = `嵌入总预算（${INDEX_EMBED_BUDGET_MS}ms）用尽，本次只处理完 ${job.updated} 个分块`;
    }

    job.ok = job.failed === 0;
    job.status = 'completed';
    job.finishedAt = new Date().toISOString();
}

/**
 * 发起重建。返回 `started=false` 表示同一知识库已有任务在跑（调用方应回 409）。
 * 先同步占位再 await 解析供应商：两个并发 POST 不能都通过「查一下有没有在跑」。
 */
export async function startKbReindex(kbId: string): Promise<{ started: boolean; job: KbReindexJobSnapshot }> {
    sweep(Date.now());
    const existing = jobs.get(kbId);
    if (existing?.status === 'running') return { started: false, job: snapshot(existing) };

    const now = new Date().toISOString();
    const job: KbReindexJob = {
        kbId,
        kbName: '',
        status: 'running',
        ok: false,
        total: 0,
        processed: 0,
        updated: 0,
        failed: 0,
        lastError: null,
        provider: null,
        startedAt: now,
        finishedAt: null,
    };
    jobs.set(kbId, job);

    try {
        const target = await resolveTarget(kbId);
        job.kbName = target.kb.name;
        job.provider = target.provider.name;
        void execute(job, target).catch((error) => failJob(job, error));
        return { started: true, job: snapshot(job) };
    } catch (error) {
        failJob(job, error);
        throw error;
    }
}

export function getKbReindexJob(kbId: string): KbReindexJobSnapshot | null {
    const job = jobs.get(kbId);
    return job ? snapshot(job) : null;
}

/** 只给测试：清空任务表，避免上一条断言看到残留状态。 */
export function resetKbReindexJobs(): void {
    jobs.clear();
}
