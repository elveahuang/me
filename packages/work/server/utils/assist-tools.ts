import { tool, type ToolSet } from 'ai';
import { eq } from 'drizzle-orm';
import { createError } from 'h3';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import * as zod from 'zod';
import { appendSessionEventsBestEffort } from '../agent/session/events';
import { artifacts, conversations } from '../db/schema';
import { db } from './db';
import { resolveAllowedPath } from './local-files';
import { continueGoal, createGoal, getGoal, readTodoState, updateGoal, writeTodoState } from './session-assist';

/**
 * 会话级待办/目标工具（P2-7）。
 * 待办与目标都绑定当前会话，模型不需要也不能指定会话 id。
 */
export const ASSIST_TOOL_SUMMARY = [
    '- todo_read：读取当前会话的待办清单（只读）',
    '- todo_write：用完整清单覆盖当前会话待办；每项含 title/status（pending|in_progress|completed）',
    '- goal_get：读取当前会话的目标与 revision/round（只读）',
    '- goal_create：为当前会话建立目标（objective、可选 maxRounds）',
    '- goal_update：更新目标状态/内容；带 expectedRevision 时冲突返回 409',
    '- exit_plan_mode：提交计划并退出计划模式，等待用户确认后再执行',
    '- present：把一个已存在的本地文件登记为当前会话的交付物（path 必须在 WORK_FILE_ROOTS 内）',
].join('\n');

const todoItemSchema = zod.object({
    id: zod.string().optional().describe('已有待办的 id；新建可省略'),
    title: zod.string().min(1).max(200),
    status: zod.enum(['pending', 'in_progress', 'completed']).default('pending'),
    note: zod.string().max(2000).optional(),
});

function fail(error: unknown): { error: { code: string; message: string } } {
    const record = error as { statusMessage?: string; message?: string };
    return { error: { code: 'ASSIST_OPERATION_FAILED', message: record?.statusMessage || record?.message || '操作失败' } };
}

export function buildAssistTools(conversationId: string): ToolSet {
    return {
        todo_read: tool({
            description: '读取当前会话的待办清单。',
            inputSchema: zod.object({}),
            execute: async () => {
                try {
                    return await readTodoState(conversationId);
                } catch (error) {
                    return fail(error);
                }
            },
        }),
        todo_write: tool({
            description: '用完整清单覆盖当前会话的待办，适合拆解多步任务并持续更新状态。',
            inputSchema: zod.object({ items: zod.array(todoItemSchema).max(50) }),
            execute: async (input) => {
                try {
                    return await writeTodoState(conversationId, input.items);
                } catch (error) {
                    return fail(error);
                }
            },
        }),
        goal_get: tool({
            description: '读取当前会话的目标、状态、revision 与轮次。',
            inputSchema: zod.object({}),
            execute: async () => {
                try {
                    return { goal: await getGoal(conversationId) };
                } catch (error) {
                    return fail(error);
                }
            },
        }),
        goal_create: tool({
            description: '为当前会话建立长期目标；一个会话只能有一个。',
            inputSchema: zod.object({
                objective: zod.string().min(4).max(4000),
                maxRounds: zod.number().int().min(1).max(100).optional(),
            }),
            execute: async (input) => {
                try {
                    return { goal: await createGoal(conversationId, input.objective, input.maxRounds) };
                } catch (error) {
                    return fail(error);
                }
            },
        }),
        goal_update: tool({
            description: '更新当前会话目标的状态或正文；expectedRevision 不匹配会被拒绝。',
            inputSchema: zod.object({
                status: zod.enum(['active', 'paused', 'completed', 'blocked']).optional(),
                objective: zod.string().min(4).max(4000).optional(),
                maxRounds: zod.number().int().min(1).max(100).optional(),
                expectedRevision: zod.number().int().optional(),
            }),
            execute: async (input) => {
                try {
                    return { goal: await updateGoal(conversationId, input) };
                } catch (error) {
                    return fail(error);
                }
            },
        }),
        goal_continue: tool({
            description: '推进当前目标一轮（只增加 round，不自动发消息）。',
            inputSchema: zod.object({}),
            execute: async () => {
                try {
                    return { goal: await continueGoal(conversationId) };
                } catch (error) {
                    return fail(error);
                }
            },
        }),
        exit_plan_mode: tool({
            description: '计划模式下提交完整计划并退出计划模式；调用后等待用户确认，不要继续执行。',
            inputSchema: zod.object({ plan: zod.string().min(1).max(20_000) }),
            execute: async (input) => {
                try {
                    const plan = input.plan
                        .replace(/\u0000/g, '')
                        .trim()
                        .slice(0, 20_000);
                    await appendSessionEventsBestEffort(conversationId, [{ type: 'plan/proposed', data: { plan } }]);
                    await db.update(conversations).set({ planMode: false, updatedAt: new Date() }).where(eq(conversations.id, conversationId));
                    return { status: 'awaiting_approval', plan, note: '计划已记录并退出计划模式。等用户确认后再执行，不要自行继续。' };
                } catch (error) {
                    return fail(error);
                }
            },
        }),
        present: tool({
            description: '把一个已存在的本地文件登记为当前会话的交付物，供用户在右侧栏下载；不会复制或修改文件。',
            inputSchema: zod.object({
                path: zod.string().min(1).max(4096).describe('绝对路径，必须位于 WORK_FILE_ROOTS 白名单内'),
                title: zod.string().max(200).optional(),
                mimeType: zod.string().max(200).optional(),
            }),
            execute: async (input) => {
                try {
                    const path = await resolveAllowedPath(input.path);
                    const info = await stat(path);
                    if (!info.isFile()) throw createError({ statusCode: 400, statusMessage: 'path 不是文件' });
                    if (info.size > 50 * 1024 * 1024) throw createError({ statusCode: 400, statusMessage: '交付物不能超过 50MB' });
                    const id = crypto.randomUUID();
                    const title =
                        (input.title || basename(path))
                            .replace(/\u0000/g, '')
                            .trim()
                            .slice(0, 200) || basename(path);
                    const mimeType = (input.mimeType || 'application/octet-stream').replace(/\u0000/g, '').slice(0, 200);
                    await db.insert(artifacts).values({ id, conversationId, title, path, mimeType, size: info.size });
                    return { id, title, path, size: info.size, mimeType };
                } catch (error) {
                    return fail(error);
                }
            },
        }),
    } as ToolSet;
}
