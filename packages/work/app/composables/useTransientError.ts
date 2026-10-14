/**
 * 局部 transient 错误提示：替代原生 alert()——阻塞式对话框、无主题、与全站 app-alert 呈现脱节。
 *
 * 动作失败处调用 show() 展示，超时自动清除；重复调用会覆盖上一条与其计时器。
 * 计时器在组件卸载时清理：SPA 内快速切页后不应继续往已销毁的 ref 写值。
 */
export function useTransientError(ttlMs = 8000) {
    const error = ref('');
    let timer: ReturnType<typeof setTimeout> | undefined;

    function show(message: string) {
        if (timer !== undefined) clearTimeout(timer);
        error.value = message;
        timer = setTimeout(() => {
            error.value = '';
            timer = undefined;
        }, ttlMs);
    }

    onBeforeUnmount(() => {
        if (timer !== undefined) clearTimeout(timer);
    });

    return { error, show };
}
