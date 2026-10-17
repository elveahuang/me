/**
 * 侧栏功能导航的唯一一张表。
 *
 * 侧栏分组与命令面板的「前往」组曾经是两份同构清单，连标签都各起一套名字（`nav.today` 与
 * `work.cmdGoToday`）——同一批页面在两处叫两个名字，改一处另一处不动。现在两处都读这里，
 * 名字只有 `nav.*` 一个来源。
 *
 * `match` 决定侧栏高亮前缀：'/' 必须精确匹配，否则包含式匹配会命中所有路由。
 * 智能体广场（`/agents`）不在表里：它刻意不占侧栏一项，只在命令面板里单独多一条入口。
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
            { to: '/tasks', labelKey: 'nav.tasks', icon: 'check-all', match: '/tasks' },
            { to: '/calendar', labelKey: 'nav.calendar', icon: 'calendar-check-outline', match: '/calendar' },
            { to: '/notes', labelKey: 'nav.notes', icon: 'book-open-page-variant-outline', match: '/notes' },
            { to: '/projects', labelKey: 'nav.projects', icon: 'folder-outline', match: '/projects' },
            { to: '/attachments', labelKey: 'nav.attachments', icon: 'file-document-outline', match: '/attachments' },
        ],
    },
    {
        titleKey: 'nav.groupAi',
        links: [
            { to: '/chat', labelKey: 'nav.chat', icon: 'chat-outline', match: '/chat' },
            { to: '/settings', labelKey: 'nav.systemSettings', icon: 'cog-outline', match: '/settings' },
        ],
    },
];
