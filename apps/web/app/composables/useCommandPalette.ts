/** 命令面板共享状态：布局里的入口按钮和全局快捷键都操作这一份。 */
export function useCommandPalette() {
    const open = useState<boolean>('work-command-palette-open', () => false);
    const query = useState<string>('work-command-palette-query', () => '');

    function show() {
        open.value = true;
    }
    function hide() {
        open.value = false;
    }
    function toggle() {
        open.value = !open.value;
    }

    return { open, query, show, hide, toggle };
}
