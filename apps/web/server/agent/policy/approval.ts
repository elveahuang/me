import type { ToolSet } from 'ai';
import { and, eq } from 'drizzle-orm';
import { approvals, type ApprovalMode, type ApprovalRisk, type ApprovalStatus } from '../../db/schema';
import { db } from '../../utils/db';
import { clipEventValue } from '../session/event-values';
import { appendSessionEventsBestEffort } from '../session/events';

/**
 * 工具审批（P1-4）。
 *
 * 审批是「执行前的一次等待」：写 approvals 行 + approval/asked 事件，工具 execute 挂起，
 * POST /api/approvals/{id}/decide 更新行并唤醒等待者；超时/进程重启一律失败关闭（不执行）。
 * 模型只看得到最终 TOOL_DENIED，看不到审批 UI（与 DSH 一致）。
 */

const APPROVAL_TIMEOUT_MS = 5 * 60_000;

const READ_TOOLS = new Set([
    'work_today',
    'work_search',
    'local_roots',
    'local_list_files',
    'local_read_file',
    'local_search_files',
    'builtin_time',
    'job_output',
    'job_list',
    'todo_read',
    'goal_get',
    'exit_plan_mode',
]);
const EXECUTE_TOOLS = new Set(['run_command', 'start_job', 'job_kill']);
const NETWORK_PREFIXES = ['http_', 'mcp_', 'web_'];

export function riskOfTool(toolName: string): ApprovalRisk {
    if (READ_TOOLS.has(toolName) || toolName.startsWith('work_list_')) return 'read';
    if (EXECUTE_TOOLS.has(toolName)) return 'execute';
    if (NETWORK_PREFIXES.some((prefix) => toolName.startsWith(prefix))) return 'network';
    return 'write';
}

/**
 * `auto`：读自动、空间内写自动，只把 shell 这类执行留给人；
 * `ask`：所有非读工具都问；`never`：只读助手，非读一律拒绝。
 */
export function requiresApproval(mode: ApprovalMode, risk: ApprovalRisk): boolean {
    if (risk === 'read') return false;
    if (mode === 'never') return true;
    if (mode === 'auto') return risk === 'execute';
    return true;
}

export interface ApprovalDecision {
    allowed: boolean;
    reason: string;
    approvalId?: string;
}

interface Waiter {
    resolve: (decision: ApprovalDecision) => void;
    timer: ReturnType<typeof setTimeout>;
    conversationId: string;
    runId: string | null;
}

const waiters = new Map<string, Waiter>();

async function appendDecisionEvent(approvalId: string, conversationId: string, runId: string | null, status: ApprovalStatus, reason: string): Promise<void> {
    await appendSessionEventsBestEffort(conversationId, [
        {
            type: 'approval/decided',
            turnId: runId,
            data: { approvalId, status, reason },
        },
    ]);
}

export interface RequestApprovalInput {
    conversationId: string;
    runId?: string | null;
    toolCallId?: string | null;
    toolName: string;
    risk: ApprovalRisk;
    payload: unknown;
    mode: ApprovalMode;
}

/** 需要审批时挂起工具执行；不需要时直接放行。 */
export async function requestToolApproval(input: RequestApprovalInput): Promise<ApprovalDecision> {
    if (!requiresApproval(input.mode, input.risk)) {
        return { allowed: input.mode !== 'never', reason: input.mode === 'never' ? '该智能体被设置为只读（never）' : '' };
    }
    if (input.mode === 'never') return { allowed: false, reason: '该智能体被设置为只读（never）' };

    const id = `ap_${crypto.randomUUID()}`;
    const reason = `工具 ${input.toolName} 需要一次审批`;
    const decisionPromise = new Promise<ApprovalDecision>((resolve) => {
        const timer = setTimeout(() => {
            waiters.delete(id);
            // 超时也要落状态，否则页面会一直看到一条 pending 审批
            void db
                .update(approvals)
                .set({ status: 'expired', reason: '审批超时，已失败关闭', decidedAt: new Date() })
                .where(and(eq(approvals.id, id), eq(approvals.status, 'pending')))
                .catch((error) => console.error('[approval] 标记超时失败:', error));
            resolve({ allowed: false, reason: '审批超时，已失败关闭', approvalId: id });
        }, APPROVAL_TIMEOUT_MS);
        waiters.set(id, {
            resolve: (decision) => {
                clearTimeout(timer);
                resolve(decision);
            },
            timer,
            conversationId: input.conversationId,
            runId: input.runId ?? null,
        });
    });

    try {
        await db.insert(approvals).values({
            id,
            conversationId: input.conversationId,
            runId: input.runId ?? null,
            toolCallId: input.toolCallId ?? null,
            toolName: input.toolName,
            risk: input.risk,
            payload: (clipEventValue(input.payload) as Record<string, unknown>) ?? {},
            status: 'pending',
        });
        await appendSessionEventsBestEffort(input.conversationId, [
            {
                type: 'approval/asked',
                turnId: input.runId ?? null,
                data: {
                    approvalId: id,
                    toolCallId: input.toolCallId ?? null,
                    toolName: input.toolName,
                    risk: input.risk,
                    payload: clipEventValue(input.payload),
                    reason,
                },
            },
        ]);
    } catch (error) {
        const waiter = waiters.get(id);
        if (waiter) clearTimeout(waiter.timer);
        waiters.delete(id);
        console.error('[approval] 写入审批失败，按拒绝处理:', error);
        return { allowed: false, reason: '审批记录写入失败，已拒绝执行', approvalId: id };
    }

    const decision = await decisionPromise;
    if (decision.allowed) {
        await appendDecisionEvent(id, input.conversationId, input.runId ?? null, 'allowed', decision.reason || '允许一次');
    } else {
        await appendDecisionEvent(id, input.conversationId, input.runId ?? null, 'rejected', decision.reason);
    }
    return decision;
}

/** 页面/AI 之外的唯一决定入口；重复决定是幂等空操作（已决行不再改）。 */
export async function decideApproval(id: string, decision: 'allow' | 'deny', reason = ''): Promise<boolean> {
    const status: ApprovalStatus = decision === 'allow' ? 'allowed' : 'rejected';
    try {
        const [row] = await db
            .update(approvals)
            .set({ status, reason: reason.slice(0, 500), decidedAt: new Date() })
            .where(and(eq(approvals.id, id), eq(approvals.status, 'pending')))
            .returning({ conversationId: approvals.conversationId, runId: approvals.runId });
        if (!row) return false;
        const waiter = waiters.get(id);
        if (waiter) {
            waiters.delete(id);
            waiter.resolve({ allowed: decision === 'allow', reason: reason || (decision === 'allow' ? '允许一次' : '用户拒绝'), approvalId: id });
        } else {
            // 没有等待者（进程重启/已超时）时这里才是唯一的事件出口；有等待者则由 requestToolApproval 统一写
            await appendDecisionEvent(id, row.conversationId, row.runId, status, reason || (decision === 'allow' ? '允许一次' : '用户拒绝'));
        }
        return true;
    } catch (error) {
        console.error('[approval] 写入决定失败:', error);
        return false;
    }
}

/** 进程重启后遗留的 pending 行没有等待者，标记为 cancelled（失败关闭）。 */
export async function cancelOrphanApprovals(): Promise<void> {
    try {
        await db.update(approvals).set({ status: 'cancelled', reason: '进程重启，审批已失效', decidedAt: new Date() }).where(eq(approvals.status, 'pending'));
    } catch (error) {
        console.error('[approval] 清理遗留审批失败:', error);
    }
}

/**
 * 给工具集的每个 execute 套一层审批。risk 从工具名推导；不需要审批时只是多一次判断。
 * 工具未提供 execute（纯客户端工具）时原样保留。
 */
export function wrapToolsWithApproval(
    toolSet: ToolSet,
    context: { conversationId: string; runId?: string | null; mode: ApprovalMode; noAnswerer?: boolean },
): ToolSet {
    const wrapped: ToolSet = { ...toolSet };
    for (const [name, definition] of Object.entries(toolSet)) {
        const candidate = definition as { execute?: (input: unknown, options: unknown) => unknown };
        if (typeof candidate.execute !== 'function') continue;
        const execute = candidate.execute.bind(definition);
        wrapped[name] = {
            ...(definition as object),
            execute: async (input: unknown, options: unknown) => {
                const toolCallId =
                    options && typeof options === 'object' && 'toolCallId' in options && typeof options.toolCallId === 'string' ? options.toolCallId : null;
                // 后台任务没有审批界面：需要审批时立即失败关闭，而不是让模型等 5 分钟
                if (context.noAnswerer && requiresApproval(context.mode, riskOfTool(name))) {
                    return { error: { code: 'TOOL_DENIED', message: '后台任务没有审批界面，本次执行已拒绝' } };
                }
                const decision = await requestToolApproval({
                    conversationId: context.conversationId,
                    runId: context.runId ?? null,
                    toolCallId,
                    toolName: name,
                    risk: riskOfTool(name),
                    payload: input,
                    mode: context.mode,
                });
                if (!decision.allowed) {
                    return { error: { code: 'TOOL_DENIED', message: decision.reason } };
                }
                return execute(input, options);
            },
        } as ToolSet[string];
    }
    return wrapped;
}
