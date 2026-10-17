/**
 * 侧栏功能导航的唯一一张表。
 *
 * 「顶部工作台 / 中间对话历史 / 底部系统设置」三段里，只有顶部这一段是可变长度的清单，
 * 所以它集中在这里：桌面侧栏与窄屏抽屉各渲染一次，两处不会因某次只改一处而菜单项分叉。
 *
 * `match` 决定侧栏高亮前缀：'/' 必须精确匹配，否则包含式匹配会命中所有路由。
 * 两个刻意不在表里的入口：系统设置固定在底部（它是「配置这台机器」而不是「工作台的一个页面」）、
 * 智能体广场（`/agents`）不占一项——它和「对话」是同一件事的两面，入口交给对话头部的切换器。
 */
export interface WorkNavLink {
    to: string;
    labelKey: string;
    icon: string;
    match: string;
}

export interface WorkNavGroup {
    titleKey: string;
    links: WorkNavLink[];
}

export const WORK_NAV_GROUPS: WorkNavGroup[] = [
    {
        titleKey: 'nav.groupWork',
        links: [
            { to: '/', labelKey: 'nav.today', icon: 'view-dashboard-outline', match: '/' },
            { to: '/tasks', labelKey: 'nav.schedules', icon: 'timer-outline', match: '/tasks' },
            { to: '/notes', labelKey: 'nav.notes', icon: 'book-open-page-variant-outline', match: '/notes' },
        ],
    },
];
