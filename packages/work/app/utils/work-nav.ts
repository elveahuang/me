/**
 * 侧栏功能导航的唯一一张表。
 *
 * 「顶部工作台 / 中间对话历史 / 底部系统设置」三段里，只有顶部这一段是可变长度的清单，
 * 所以它集中在这里：桌面侧栏与窄屏抽屉各渲染一次，两处不会因某次只改一处而菜单项分叉。
 *
 * 顶部那一段现在是「新建对话」（由布局渲染的按钮，它不是路由）加上这一张表。
 * 条目按工作流排列：今日 → 工作空间 → 资料库 → 自动化（内置运行记录 Tab）；最近对话由布局单独渲染。
 *
 * `match` 决定侧栏高亮前缀。两个刻意不在表里的入口：系统设置固定在底部（它是「配置这台机器」而不是
 * 「工作台的一个页面」）、智能体广场（`/agents`）不占一项——它和「对话」是同一件事的两面，入口交给对话头部的切换器。
 */
export interface WorkNavLink {
    to: string;
    labelKey: string;
    icon: string;
    match: string;
}

export const WORK_NAV_LINKS: WorkNavLink[] = [
    { to: '/', labelKey: 'nav.today', icon: 'view-dashboard-outline', match: '/' },
    { to: '/spaces', labelKey: 'nav.spaces', icon: 'folder-outline', match: '/spaces' },
    { to: '/library', labelKey: 'nav.library', icon: 'bookshelf', match: '/library' },
    { to: '/tasks', labelKey: 'nav.schedules', icon: 'timer-outline', match: '/tasks' },
];
