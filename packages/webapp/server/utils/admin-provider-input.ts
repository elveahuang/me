import { createError } from 'h3';

/**
 * 供应商模型列表（`providers.models`）归一。
 *
 * 这份列表会被 `/api/admin/agents.get.ts`、`auto-config` 拼进提示词、以及 self-config 的
 * `list` 工具结果带进模型上下文，所以条数和单条长度都要有上限；jsonb 列本身不校验形状，
 * 上游 `/models` 返回非字符串 id 时若不拦，就会存下永不匹配 `models.includes(model)`、
 * 在管理端 textarea 里显示成 `[object Object]` 的脏数据。
 */

/** 单条模型 id 上限，与 self-config 切换模型时的 modelId 长度校验一致 */
const MODEL_ID_MAX_LEN = 100;
/** 模型列表条数上限 */
const MODEL_LIST_LIMIT = 200;

/**
 * - `reject`：管理端提交，形状不合法直接 400（POST 与 PATCH 用同一口径）
 * - `skip`：上游 `/models` 响应，坏项只丢该项，整表截到上限
 */
export function normalizeProviderModels(raw: unknown, mode: 'reject' | 'skip'): string[] {
    const bad = (message: string) => {
        if (mode === 'reject') throw createError({ statusCode: 400, statusMessage: message });
    };
    if (!Array.isArray(raw)) {
        bad('models 必须为字符串数组');
        return [];
    }
    const out: string[] = [];
    for (const item of raw as unknown[]) {
        if (typeof item !== 'string') {
            bad('models 必须为字符串数组');
            continue;
        }
        const id = item.trim();
        if (!id) {
            bad('models 不能包含空项');
            continue;
        }
        if (id.length > MODEL_ID_MAX_LEN) {
            bad(`模型 id 过长（最多 ${MODEL_ID_MAX_LEN} 字符）`);
            continue;
        }
        if (!out.includes(id)) out.push(id);
    }
    if (out.length > MODEL_LIST_LIMIT) {
        bad(`模型数量过多（最多 ${MODEL_LIST_LIMIT} 个）`);
        return out.slice(0, MODEL_LIST_LIMIT);
    }
    return out;
}
