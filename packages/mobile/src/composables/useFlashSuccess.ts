import { onBeforeUnmount, ref } from 'vue';

/**
 * 成功提示：显示文本并在超时后自动清除，替代此前每个页面各写一份的
 * 「success ref + successTimer + 卸载清理」三件套——三件里漏掉任何一件，
 * SPA 快速进出页面就会留下继续写状态的定时器。
 *
 * `flashSuccess(text, ms?)`：自动清除的瞬时提示，默认时长由入参 defaultMs 决定（各页面沿用原有默认值）。
 *
 * 移动端无自动导入，视图需显式 import 本文件。
 */
export function useFlashSuccess(defaultMs = 2500) {
    const success = ref('');
    let timer: ReturnType<typeof setTimeout> | null = null;

    function flashSuccess(text: string, ms = defaultMs) {
        success.value = text;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => (success.value = ''), ms);
    }

    onBeforeUnmount(() => {
        if (timer) clearTimeout(timer);
        timer = null;
    });

    return { success, flashSuccess };
}
