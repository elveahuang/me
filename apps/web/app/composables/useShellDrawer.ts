/**
 * 外壳抽屉开关：布局持有，ChatPane 头部的历史按钮（窄屏）也开同一个抽屉——
 * 会话列表已并进左栏/抽屉，不再有独立的移动端历史抽屉。
 */
export function useShellDrawer() {
    const open = useState<boolean>('shell-drawer-open', () => false);
    return { open };
}
