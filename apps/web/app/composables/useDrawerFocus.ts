import { nextTick, onBeforeUnmount, onMounted, type Ref, watch } from 'vue';

/**
 * 模态面（抽屉、弹层）的无障碍焦点与滚动行为：
 * - Esc 关闭（调用 onClose）；
 * - Tab 焦点圈闭在面板内，焦点逃出面板时拉回首个可聚焦元素；
 * - 打开时锁 body 滚动并把焦点移入面板，关闭后归还给触发元素。
 * open 必须是响应式来源（getter），面板元素在其为 true 后须已挂载。
 */
/**
 * 浏览器侧的模态面栈（只在 onMounted/watch 的客户端分支里增删，SSR 不触碰）。
 *
 * 弹层可以套弹层：AdminDrawer 的 slot 里再打开 ImagePicker 就是两层。若每份 hook 都无条件响应
 * Esc/Tab，两层的焦点圈闭会互相把对方 panel 里的焦点拽出来（表现为 Tab 按不动、Esc 一次关掉两层），
 * 而上层关闭时若无条件解锁 body，抽屉还开着滚动就已经恢复。所以只有栈顶那份接管键盘，
 * 滚动锁按「栈里还有没有层」决定。
 */
const layerStack: symbol[] = [];

export function useDrawerFocus(open: () => boolean, panel: Ref<HTMLElement | null>, onClose: () => void) {
    /** 打开前的焦点元素，关闭后归还，避免焦点丢失到 body */
    let lastFocused: HTMLElement | null = null;
    /** 本实例在模态面栈中的身份 */
    const layer = Symbol('drawer-layer');

    function syncBodyLock() {
        document.body.style.overflow = layerStack.length ? 'hidden' : '';
    }

    function focusables(): HTMLElement[] {
        const root = panel.value;
        if (!root) return [];
        return Array.from(
            root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select, input, textarea, [tabindex]:not([tabindex="-1"])'),
        ).filter((el) => el.offsetParent !== null);
    }

    /** Tab 焦点圈闭在面板内，否则遮罩背后的页面元素仍可达 */
    function trapFocus(event: KeyboardEvent) {
        const list = focusables();
        if (list.length === 0) return;
        const current = document.activeElement;
        if (!(current instanceof Node) || !panel.value?.contains(current)) {
            event.preventDefault();
            list[0]?.focus();
            return;
        }
        const first = list[0]!;
        const last = list[list.length - 1]!;
        if (event.shiftKey && current === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && current === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function onKeydown(e: KeyboardEvent) {
        if (!open()) return;
        // 有上层弹层开着时交给它接管，否则两层会轮流把焦点往自己的 panel 里拽
        if (layerStack[layerStack.length - 1] !== layer) return;
        if (e.key === 'Escape') onClose();
        else if (e.key === 'Tab') trapFocus(e);
    }

    watch(open, async (isOpen) => {
        if (typeof document === 'undefined') return;
        const at = layerStack.indexOf(layer);
        if (isOpen) {
            if (at === -1) layerStack.push(layer);
        } else if (at !== -1) {
            layerStack.splice(at, 1);
        }
        syncBodyLock();
        if (isOpen) {
            lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            await nextTick();
            focusables()[0]?.focus();
        } else {
            lastFocused?.focus();
            lastFocused = null;
        }
    });

    onMounted(() => window.addEventListener('keydown', onKeydown));
    onBeforeUnmount(() => {
        window.removeEventListener('keydown', onKeydown);
        if (typeof document === 'undefined') return;
        // 组件在打开状态下被卸载（父级 v-if、路由切走）：把这一层从栈里摘掉再决定要不要解锁，
        // 否则会把下层还开着的弹层的滚动锁一起解掉
        const at = layerStack.indexOf(layer);
        if (at !== -1) layerStack.splice(at, 1);
        syncBodyLock();
    });
}
