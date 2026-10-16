<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * 设置区的子导航（通用 / 智能体 / 模型 / 存储 / 技能 / 工具 / MCP / 知识库）。
 *
 * 每个设置页在自己的根节点里挂一次，而不是另建一层 layout：
 * 外壳（侧栏、抽屉、焦点圈闭）都在 `layouts/default.vue`，再套一层 layout 要么复制那份外壳、
 * 要么依赖嵌套 layout 的实现细节。子导航只是页面内容的一部分，随页面走最省事，也不会出现
 * 「layout 里改了导航、页面各自还留一份」的分叉。
 *
 * 窄屏不折成两行：8 个条目换行会把列表区推到折叠线以下，改成横向滚动（`min-w-max` + 外层 overflow-x-auto）。
 */
const { t } = useI18n();
const route = useRoute();

const items = computed(() => [
    { to: '/settings', label: t('settings.navGeneral'), icon: 'cog-outline' },
    { to: '/settings/agents', label: t('settings.navAgents'), icon: 'robot-outline' },
    { to: '/settings/providers', label: t('settings.navProviders'), icon: 'brain' },
    { to: '/settings/storage', label: t('settings.navStorage'), icon: 'database-outline' },
    { to: '/settings/skills', label: t('settings.navSkills'), icon: 'lightning-bolt-outline' },
    { to: '/settings/tools', label: t('settings.navTools'), icon: 'wrench-outline' },
    { to: '/settings/mcp', label: t('settings.navMcp'), icon: 'power-plug-outline' },
    { to: '/settings/knowledge', label: t('settings.navKnowledge'), icon: 'book-open-page-variant-outline' },
]);

/** `/settings` 必须精确匹配，否则前缀匹配会把 8 个条目全点亮；子页面按 `to + '/'` 前缀命中 */
function isActive(to: string) {
    const path = route.path;
    return to === '/settings' ? path === '/settings' : path === to || path.startsWith(`${to}/`);
}
</script>

<template>
    <nav class="border-line overflow-x-auto border-b pb-3" :aria-label="t('settings.navTitle')">
        <div class="flex min-w-max items-center gap-1.5">
            <NuxtLink
                v-for="item in items"
                :key="item.to"
                :to="item.to"
                class="app-btn app-btn-sm"
                :class="isActive(item.to) ? 'app-btn-soft text-strong' : 'app-btn-ghost text-faint'"
                :aria-current="isActive(item.to) ? 'page' : undefined"
            >
                <AppIcon :name="item.icon" :size="15" />
                <span>{{ item.label }}</span>
            </NuxtLink>
        </div>
    </nav>
</template>
