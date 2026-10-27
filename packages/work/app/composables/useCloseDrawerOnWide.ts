import { onBeforeUnmount, onMounted, type Ref } from 'vue';

/** Tailwind lg 断点：≥1024px 时抽屉本体被 lg:hidden 藏掉 */
const WIDE_QUERY = '(min-width: 1024px)';

/**
 * 视口跨过抽屉所属断点变宽时自动关闭抽屉。
 * hidden 工具类只隐藏 DOM，抽屉打开时的 body 滚动锁与 Tab 焦点圈闭不会跟着消失，
 * 窄屏打开后把窗口拉宽（或横竖屏旋转）就会留下「页面看着正常、滚不动也按不动 Tab」的坏状态。
 * 抽屉用的是 lg:hidden 之外的其他断点（如 md:hidden）时必须传对应的 wideQuery。
 */
export function useCloseDrawerOnWide(open: Ref<boolean>, wideQuery = WIDE_QUERY) {
    // matchMedia 每次调用返回新对象，removeEventListener 必须用同一个实例
    let mql: MediaQueryList | null = null;

    function onChange(event: MediaQueryListEvent) {
        if (event.matches && open.value) open.value = false;
    }

    onMounted(() => {
        mql = window.matchMedia(wideQuery);
        mql.addEventListener('change', onChange);
    });

    onBeforeUnmount(() => {
        mql?.removeEventListener('change', onChange);
        mql = null;
    });
}
