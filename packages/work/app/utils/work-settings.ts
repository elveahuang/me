/**
 * 设置区八个子页面的唯一清单。
 *
 * 子导航与通用页的入口卡片两处都要用同一份路由表。设置区在侧栏底部只有一项「系统设置」，
 * 用户发现子页面的路径全靠这两处——各写一份的话，新增一页要改两个地方，漏掉的那处的表现是「页面存在但点不到」。
 */
export interface WorkSettingsPage {
    /** 条目唯一键（也是深链 `?section=` 用的键） */
    id: string;
    to: string;
    /** 侧栏子导航与卡片标题用的短名 */
    labelKey: string;
    /** 一句话说明，即该子页面自己的页头副标题 */
    descKey: string;
    icon: string;
    /** 左侧设置导航的分组 */
    groupKey: 'workspace' | 'capabilities' | 'data';
}

export const WORK_SETTINGS_PAGES: WorkSettingsPage[] = [
    { id: 'general', to: '/settings', labelKey: 'settings.navGeneral', descKey: 'settings.generalSubtitle', icon: 'cog-outline', groupKey: 'workspace' },
    {
        id: 'agents',
        to: '/settings/agents',
        labelKey: 'settings.navAgents',
        descKey: 'adminForm.agentSubtitle',
        icon: 'robot-outline',
        groupKey: 'capabilities',
    },
    {
        id: 'providers',
        to: '/settings/providers',
        labelKey: 'settings.navProviders',
        descKey: 'adminForm.providerSubtitle',
        icon: 'brain',
        groupKey: 'capabilities',
    },
    {
        id: 'storage',
        to: '/settings/storage',
        labelKey: 'settings.navStorage',
        descKey: 'settings.storageSubtitle',
        icon: 'database-outline',
        groupKey: 'data',
    },
    {
        id: 'skills',
        to: '/settings/skills',
        labelKey: 'settings.navSkills',
        descKey: 'adminForm.skillSubtitle',
        icon: 'lightning-bolt-outline',
        groupKey: 'capabilities',
    },
    { id: 'tools', to: '/settings/tools', labelKey: 'settings.navTools', descKey: 'adminForm.toolSubtitle', icon: 'wrench-outline', groupKey: 'capabilities' },
    { id: 'mcp', to: '/settings/mcp', labelKey: 'settings.navMcp', descKey: 'adminForm.mcpSubtitle', icon: 'power-plug-outline', groupKey: 'capabilities' },
    {
        id: 'knowledge',
        to: '/settings/knowledge',
        labelKey: 'settings.navKnowledge',
        descKey: 'adminForm.kbSubtitle',
        icon: 'book-open-page-variant-outline',
        groupKey: 'capabilities',
    },
];
