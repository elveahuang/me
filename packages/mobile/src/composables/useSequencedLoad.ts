import { extractApiError } from '@commons/contract';
import type { Ref } from 'vue';
import { ref } from 'vue';
import { i18n } from '../i18n';

export interface LoadGuard {
    /** await 之后必须先调它：为 true 表示已有更新一轮的加载，本响应不得写回任何状态 */
    isStale(): boolean;
    /** 在 finally 里调用：只有仍是最新一轮时才关掉 loading */
    finish(): void;
}

/**
 * 列表/详情视图共用的「过期响应护栏」。
 *
 * 下拉刷新、标签页回场（onIonViewWillEnter）、筛选/翻页/watch 都可能并发触发同一条 load()：
 * 先发后回的旧响应会把新条件的结果写回去。七个视图曾各自抄一份
 * `let loadSeq = 0; const seq = ++loadSeq; if (seq !== loadSeq) return;`，
 * 这里收口成一份，视图只保留自己不同的 catch 分支（清哪些状态各不相同）。
 *
 * 用法：
 * ```ts
 * const { loading, error, begin } = useSequencedLoad();
 * async function load() {
 *     const guard = begin();
 *     try {
 *         const res = await api<T>('/api/...');
 *         if (guard.isStale()) return;
 *         items.value = res.items;
 *     } catch (e) {
 *         if (guard.isStale()) return;
 *         items.value = [];
 *         error.value = extractApiError(e, i18n.global.t('common.error'));
 *     } finally {
 *         guard.finish();
 *     }
 * }
 * ```
 */
export function useSequencedLoad(initialLoading = true): { loading: Ref<boolean>; error: Ref<string>; begin(): LoadGuard } {
    const loading = ref(initialLoading);
    const error = ref('');
    let seq = 0;

    function begin(): LoadGuard {
        const current = ++seq;
        loading.value = true;
        error.value = '';
        return {
            isStale: () => current !== seq,
            finish: () => {
                if (current === seq) loading.value = false;
            },
        };
    }

    return { loading, error, begin };
}

/** 与 useSequencedLoad 配套的默认错误文案（各视图 fallback 文案相同，收口一处）。 */
export function loadErrorMessage(e: unknown): string {
    return extractApiError(e, i18n.global.t('common.error'));
}
