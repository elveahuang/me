/**
 * 设置区八个子页面的唯一清单。
 *
 * 子导航、命令面板、通用页的入口卡片三处都要用同一份路由表。设置区在侧栏里只有一项「系统设置」，
 * 用户发现子页面的路径全靠这三处——各写一份的话，新增一页要改三个地方，漏掉的那处的表现是「页面存在但点不到」。
 */
export interface WorkSettingsPage {
    /** 条目唯一键（也是命令面板的 command id 后缀） */
    id: string;
    to: string;
    /** 侧栏子导航与卡片标题用的短名 */
    labelKey: string;
    /** 一句话说明，即该子页面自己的页头副标题 */
    descKey: string;
    icon: string;
}

export const WORK_SETTINGS_PAGES: WorkSettingsPage[] = [
    { id: 'general', to: '/settings', labelKey: 'settings.navGeneral', descKey: 'settings.generalSubtitle', icon: 'cog-outline' },
    { id: 'agents', to: '/settings/agents', labelKey: 'settings.navAgents', descKey: 'adminForm.agentSubtitle', icon: 'robot-outline' },
    { id: 'providers', to: '/settings/providers', labelKey: 'settings.navProviders', descKey: 'adminForm.providerSubtitle', icon: 'brain' },
    { id: 'storage', to: '/settings/storage', labelKey: 'settings.navStorage', descKey: 'settings.storageSubtitle', icon: 'database-outline' },
    { id: 'skills', to: '/settings/skills', labelKey: 'settings.navSkills', descKey: 'adminForm.skillSubtitle', icon: 'lightning-bolt-outline' },
    { id: 'tools', to: '/settings/tools', labelKey: 'settings.navTools', descKey: 'adminForm.toolSubtitle', icon: 'wrench-outline' },
    { id: 'mcp', to: '/settings/mcp', labelKey: 'settings.navMcp', descKey: 'adminForm.mcpSubtitle', icon: 'power-plug-outline' },
    { id: 'knowledge', to: '/settings/knowledge', labelKey: 'settings.navKnowledge', descKey: 'adminForm.kbSubtitle', icon: 'book-open-page-variant-outline' },
];
