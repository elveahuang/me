import { and, eq, sql } from 'drizzle-orm';
import { createError } from 'h3';
import { appendSessionEventsBestEffort } from '../agent/session/events';
import { GOAL_STATUSES, TODO_STATUSES, goals, todos, type Goal, type GoalStatus, type TodoItem, type TodoStatus } from '../db/schema';
import { db } from './db';

/**
 * 会话级待办与目标（P2-7）。
 *
 * 待办是「一个会话一份清单」，`todo_write` 整表替换而不是逐项 CRUD：模型每轮只需要
 * 把当前真实状态覆盖进来，UI 与事件都能拿到完整快照，不会出现「删了一项但事件只记了增量」。
 * 目标一个会话最多一条，`revision` 做乐观并发；不做自动续跑，继续按钮只推进 round。
 */

export const TODO_MAX_ITEMS = 50;
export const TODO_TITLE_MAX = 200;
export const TODO_NOTE_MAX = 2000;
export const GOAL_OBJECTIVE_MAX = 4000;
export const GOAL_MAX_ROUNDS_LIMIT = 100;

export interface TodoState {
    items: TodoItem[];
    updatedAt: Date | null;
}

function text(value: unknown, max: number): string {
    return typeof value === 'string'
        ? value
              .replace(/\u0000/g, '')
              .trim()
              .slice(0, max)
        : '';
}

export function normalizeTodoItems(input: unknown): TodoItem[] {
    if (!Array.isArray(input)) throw createError({ statusCode: 400, statusMessage: 'items 必须是数组' });
    if (input.length > TODO_MAX_ITEMS) throw createError({ statusCode: 400, statusMessage: `待办最多 ${TODO_MAX_ITEMS} 项` });
    const seen = new Set<string>();
    const items: TodoItem[] = [];
    for (const raw of input) {
        if (!raw || typeof raw !== 'object') throw createError({ statusCode: 400, statusMessage: '待办项格式不正确' });
        const record = raw as Record<string, unknown>;
        const title = text(record.title, TODO_TITLE_MAX);
        if (!title) throw createError({ statusCode: 400, statusMessage: '待办标题不能为空' });
        const status = (TODO_STATUSES as readonly string[]).includes(String(record.status)) ? (record.status as TodoStatus) : 'pending';
        let id = text(record.id, 64) || crypto.randomUUID();
        if (seen.has(id)) id = crypto.randomUUID();
        seen.add(id);
        const note = text(record.note, TODO_NOTE_MAX);
        items.push(note ? { id, title, status, note } : { id, title, status });
    }
    return items;
}

export async function readTodoState(conversationId: string): Promise<TodoState> {
    const [row] = await db.select().from(todos).where(eq(todos.conversationId, conversationId)).limit(1);
    return { items: row?.items ?? [], updatedAt: row?.updatedAt ?? null };
}

export async function writeTodoState(conversationId: string, input: unknown): Promise<TodoState> {
    const items = normalizeTodoItems(input);
    const now = new Date();
    await db
        .insert(todos)
        .values({ conversationId, items, updatedAt: now })
        .onConflictDoUpdate({ target: todos.conversationId, set: { items, updatedAt: now } });
    await appendSessionEventsBestEffort(conversationId, [{ type: 'todo/updated', data: { items, source: 'tool' } }]);
    return { items, updatedAt: now };
}

export function normalizeGoalObjective(input: unknown): string {
    const objective = text(input, GOAL_OBJECTIVE_MAX);
    if (objective.length < 4) throw createError({ statusCode: 400, statusMessage: '目标至少 4 个字' });
    return objective;
}

export function normalizeMaxRounds(input: unknown, fallback = 10): number {
    const value = Number(input);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(GOAL_MAX_ROUNDS_LIMIT, Math.max(1, Math.trunc(value)));
}

export async function getGoal(conversationId: string): Promise<Goal | null> {
    const [row] = await db.select().from(goals).where(eq(goals.conversationId, conversationId)).limit(1);
    return row ?? null;
}

export async function createGoal(conversationId: string, objectiveInput: unknown, maxRoundsInput?: unknown): Promise<Goal> {
    const objective = normalizeGoalObjective(objectiveInput);
    const maxRounds = normalizeMaxRounds(maxRoundsInput);
    const existing = await getGoal(conversationId);
    if (existing) throw createError({ statusCode: 409, statusMessage: '这个会话已经有目标；要改请用 update_goal' });
    const [row] = await db.insert(goals).values({ id: crypto.randomUUID(), conversationId, objective, maxRounds }).onConflictDoNothing().returning();
    if (!row) throw createError({ statusCode: 409, statusMessage: '这个会话已经有目标；要改请用 update_goal' });
    await appendSessionEventsBestEffort(conversationId, [{ type: 'goal/updated', data: { action: 'created', goal: row } }]);
    return row as Goal;
}

export interface GoalPatch {
    objective?: unknown;
    status?: unknown;
    maxRounds?: unknown;
    expectedRevision?: unknown;
}

export async function updateGoal(conversationId: string, patch: GoalPatch): Promise<Goal> {
    const existing = await getGoal(conversationId);
    if (!existing) throw createError({ statusCode: 404, statusMessage: '这个会话还没有目标' });
    const expected = Number(patch.expectedRevision);
    if (Number.isFinite(expected) && expected !== existing.revision) {
        throw createError({ statusCode: 409, statusMessage: '目标已被其他操作修改，请重新读取后再更新' });
    }
    const status =
        patch.status === undefined
            ? existing.status
            : (GOAL_STATUSES as readonly string[]).includes(String(patch.status))
              ? (patch.status as GoalStatus)
              : null;
    if (status === null) throw createError({ statusCode: 400, statusMessage: 'status 不合法' });
    const [row] = await db
        .update(goals)
        .set({
            objective: patch.objective === undefined ? existing.objective : normalizeGoalObjective(patch.objective),
            status,
            maxRounds: patch.maxRounds === undefined ? existing.maxRounds : normalizeMaxRounds(patch.maxRounds),
            revision: existing.revision + 1,
            updatedAt: new Date(),
        })
        .where(and(eq(goals.id, existing.id), eq(goals.revision, existing.revision)))
        .returning();
    if (!row) throw createError({ statusCode: 409, statusMessage: '目标已被其他操作修改，请重新读取后再更新' });
    await appendSessionEventsBestEffort(conversationId, [{ type: 'goal/updated', data: { action: 'updated', goal: row } }]);
    return row as Goal;
}

/** 「继续」按钮：只推进轮次，不自动发消息；真正继续由用户发下一条消息触发。 */
export async function continueGoal(conversationId: string): Promise<Goal> {
    const existing = await getGoal(conversationId);
    if (!existing) throw createError({ statusCode: 404, statusMessage: '这个会话还没有目标' });
    if (existing.status === 'completed' || existing.status === 'blocked') {
        throw createError({ statusCode: 409, statusMessage: '目标已结束，先更新状态再继续' });
    }
    if (existing.round >= existing.maxRounds) throw createError({ statusCode: 409, statusMessage: '已达到最大轮次' });
    const [row] = await db
        .update(goals)
        .set({ round: sql`${goals.round} + 1`, status: 'active', revision: sql`${goals.revision} + 1`, updatedAt: new Date() })
        .where(eq(goals.id, existing.id))
        .returning();
    await appendSessionEventsBestEffort(conversationId, [{ type: 'goal/updated', data: { action: 'continued', goal: row } }]);
    return row as Goal;
}
