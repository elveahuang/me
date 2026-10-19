import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { createError } from 'h3';
import { spawn, type ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { jobChunks, jobs, type JobStatus } from '../db/schema';
import { isCommandEnabled, killTree, safeEnv } from './command-tools';
import { db } from './db';
import { resolveAllowedPath } from './local-files';

/**
 * 后台命令（P2-3）。
 *
 * 进程只在当前 Nitro 进程活着时受管；输出按块落 `job_chunks`，`job_output` 按 seq 增量读。
 * 重启后启动插件把遗留 running 标成 interrupted（无法安全地按 pid 杀，pid 可能已被复用）。
 */

const MAX_JOB_OUTPUT_BYTES = 2_000_000;
const MAX_CHUNK_BYTES = 8_000;
const running = new Map<string, ChildProcess>();
const queues = new Map<string, Promise<void>>();

export interface JobRecord {
    id: string;
    conversationId: string | null;
    agentId: string | null;
    command: string;
    cwd: string;
    status: JobStatus;
    pid: number | null;
    exitCode: number | null;
    error: string;
    outputBytes: number;
    createdAt: Date;
    finishedAt: Date | null;
}

async function appendChunk(jobId: string, stream: 'stdout' | 'stderr', text: string): Promise<void> {
    if (!text) return;
    const chunk = text.slice(0, MAX_CHUNK_BYTES);
    const previous = queues.get(jobId) ?? Promise.resolve();
    const next = previous
        .then(async () => {
            const [row] = await db.select({ outputBytes: jobs.outputBytes }).from(jobs).where(eq(jobs.id, jobId));
            if (!row || row.outputBytes >= MAX_JOB_OUTPUT_BYTES) return;
            await db.insert(jobChunks).values({ id: `jc_${crypto.randomUUID()}`, jobId, stream, content: chunk });
            await db
                .update(jobs)
                .set({ outputBytes: sql`${jobs.outputBytes} + ${Buffer.byteLength(chunk, 'utf8')}` })
                .where(eq(jobs.id, jobId));
        })
        .catch((error) => console.error('[jobs] 写入输出失败:', error));
    queues.set(jobId, next);
    await next;
}

async function finishJob(jobId: string, status: JobStatus, exitCode: number | null, error = ''): Promise<void> {
    await (queues.get(jobId) ?? Promise.resolve()).catch(() => undefined);
    queues.delete(jobId);
    running.delete(jobId);
    await db
        .update(jobs)
        .set({ status, exitCode, error: error.slice(0, 1000), finishedAt: new Date() })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')));
}

export async function startBackgroundJob(input: {
    command: unknown;
    cwd?: unknown;
    conversationId?: string | null;
    agentId?: string | null;
}): Promise<JobRecord> {
    if (!isCommandEnabled()) throw createError({ statusCode: 403, statusMessage: '后台命令未开启，请先在 .env 设置 WORK_COMMAND_ENABLED=1' });
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    if (!command) throw createError({ statusCode: 400, statusMessage: 'command 不能为空' });
    if (command.length > 4_000) throw createError({ statusCode: 400, statusMessage: 'command 最长 4000 字符' });
    const cwdRaw = typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd.trim() : '';
    if (!cwdRaw) throw createError({ statusCode: 400, statusMessage: 'cwd 必填：必须是 WORK_FILE_ROOTS 内的绝对目录' });
    const cwd = await resolveAllowedPath(cwdRaw);
    if (!(await stat(cwd)).isDirectory()) throw createError({ statusCode: 400, statusMessage: 'cwd 必须是目录' });

    const id = `job_${crypto.randomUUID()}`;
    await db.insert(jobs).values({
        id,
        conversationId: input.conversationId ?? null,
        agentId: input.agentId ?? null,
        command,
        cwd,
        status: 'running',
    });

    const child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        detached: process.platform !== 'win32',
        env: safeEnv(),
    });
    running.set(id, child);
    if (child.pid) await db.update(jobs).set({ pid: child.pid }).where(eq(jobs.id, id));

    child.stdout?.on('data', (chunk: Buffer) => void appendChunk(id, 'stdout', chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => void appendChunk(id, 'stderr', chunk.toString('utf8')));
    child.on('error', (error) => void finishJob(id, 'failed', null, error.message));
    child.on('close', (code, signal) => {
        const status: JobStatus = code === 0 ? 'completed' : 'failed';
        void finishJob(id, status, code, signal ? `signal ${signal}` : '');
    });

    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    return row as JobRecord;
}

export async function killBackgroundJob(jobId: string): Promise<boolean> {
    const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    if (!row || row.status !== 'running') return false;
    const child = running.get(jobId);
    killTree(child?.pid ?? row.pid ?? undefined);
    await finishJob(jobId, 'killed', null, '用户终止');
    return true;
}

export interface JobOutput {
    job: JobRecord;
    chunks: { seq: number; stream: 'stdout' | 'stderr'; content: string }[];
    nextSeq: number;
    done: boolean;
}

export async function readJobOutput(jobId: string, afterSeq = 0, limit = 100): Promise<JobOutput> {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    if (!job) throw createError({ statusCode: 404, statusMessage: '作业不存在' });
    const chunks = await db
        .select({ seq: jobChunks.seq, stream: jobChunks.stream, content: jobChunks.content })
        .from(jobChunks)
        .where(and(eq(jobChunks.jobId, jobId), gt(jobChunks.seq, afterSeq)))
        .orderBy(asc(jobChunks.seq))
        .limit(Math.min(Math.max(limit, 1), 200));
    return {
        job: job as JobRecord,
        chunks,
        nextSeq: chunks.length ? chunks[chunks.length - 1]!.seq : afterSeq,
        done: job.status !== 'running',
    };
}

export async function listJobs(conversationId?: string | null, limit = 30): Promise<JobRecord[]> {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = conversationId
        ? await db.select().from(jobs).where(eq(jobs.conversationId, conversationId)).orderBy(desc(jobs.createdAt)).limit(capped)
        : await db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(capped);
    return rows as JobRecord[];
}

export async function markInterruptedJobs(): Promise<number> {
    const rows = await db
        .update(jobs)
        .set({ status: 'interrupted', error: '进程重启，作业已失去控制', finishedAt: new Date() })
        .where(eq(jobs.status, 'running'))
        .returning({ id: jobs.id });
    return rows.length;
}
