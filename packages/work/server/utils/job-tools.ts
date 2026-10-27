import { tool, type ToolSet } from 'ai';
import * as zod from 'zod';
import { isCommandEnabled } from './command-tools';
import { killBackgroundJob, listJobs, readJobOutput, startBackgroundJob } from './jobs';

export const JOB_TOOL_SUMMARY = [
    '- start_job：在后台执行命令（需 WORK_COMMAND_ENABLED=1 与人工审批），立刻返回 jobId',
    '- job_output：按 afterSeq 增量读取后台输出与状态',
    '- job_kill：终止后台作业',
    '- job_list：列出当前会话的作业',
].join('\n');

function explain(error: unknown): string {
    const record = error as { statusMessage?: string; message?: string };
    return `作业操作失败：${record?.statusMessage || '请检查命令与目录'}`;
}

export function buildJobTools(context: { conversationId: string; agentId: string | null }): ToolSet {
    if (!isCommandEnabled()) return {} as ToolSet;
    return {
        start_job: tool({
            description: '在 WORK_FILE_ROOTS 内的目录后台执行命令，立即返回 jobId；之后用 job_output 增量读输出。适合长任务。',
            inputSchema: zod.object({
                command: zod.string().describe('要执行的 shell 命令'),
                cwd: zod.string().describe('绝对目录，必须在 WORK_FILE_ROOTS 内'),
            }),
            execute: async (input) => {
                try {
                    const job = await startBackgroundJob({
                        command: input.command,
                        cwd: input.cwd,
                        conversationId: context.conversationId,
                        agentId: context.agentId,
                    });
                    return { jobId: job.id, status: job.status, pid: job.pid, command: job.command, cwd: job.cwd };
                } catch (error) {
                    return { error: { code: 'JOB_START_FAILED', message: explain(error) } };
                }
            },
        }),
        job_output: tool({
            description: '读取后台作业的增量输出。afterSeq 用上一次返回的 nextSeq；最多返回 200 块。',
            inputSchema: zod.object({
                jobId: zod.string().describe('start_job 返回的 jobId'),
                afterSeq: zod.number().optional().describe('只返回 seq 大于此值的输出，默认 0'),
                limit: zod.number().optional().describe('最多返回块数，默认 100，最大 200'),
            }),
            execute: async (input) => {
                try {
                    const output = await readJobOutput(input.jobId, Number(input.afterSeq) || 0, Number(input.limit) || 100);
                    return {
                        jobId: output.job.id,
                        status: output.job.status,
                        exitCode: output.job.exitCode,
                        done: output.done,
                        nextSeq: output.nextSeq,
                        output: output.chunks.map((chunk) => `[${chunk.stream}] ${chunk.content}`).join('\n'),
                    };
                } catch (error) {
                    return { error: { code: 'JOB_OUTPUT_FAILED', message: explain(error) } };
                }
            },
        }),
        job_kill: tool({
            description: '终止一个仍在运行的后台作业（会杀整棵进程树）。',
            inputSchema: zod.object({ jobId: zod.string().describe('要终止的 jobId') }),
            execute: async (input) => {
                try {
                    const killed = await killBackgroundJob(input.jobId);
                    return { jobId: input.jobId, killed };
                } catch (error) {
                    return { error: { code: 'JOB_KILL_FAILED', message: explain(error) } };
                }
            },
        }),
        job_list: tool({
            description: '列出当前会话最近的后台作业。',
            inputSchema: zod.object({}),
            execute: async () => {
                try {
                    const rows = await listJobs(context.conversationId, 30);
                    return rows.map((job) => ({
                        jobId: job.id,
                        status: job.status,
                        command: job.command,
                        exitCode: job.exitCode,
                        createdAt: job.createdAt,
                    }));
                } catch (error) {
                    return { error: { code: 'JOB_LIST_FAILED', message: explain(error) } };
                }
            },
        }),
    } as ToolSet;
}
