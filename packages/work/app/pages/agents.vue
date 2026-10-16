<script setup lang="ts">
import type { AgentSummary } from '@commons/contract';
import { useI18n } from 'vue-i18n';

/**
 * 智能体广场（`/agents`）：只有智能体网格。
 *
 * 它是挑选对话对象的地方，不进侧栏（侧栏只留「对话」一项）：入口是 `/chat` 头部的智能体切换器、
 * 命令面板的「前往智能体」，以及 `/chat/:agentId` 找不到智能体时的返回链接。
 * 会话列表在布局左栏，这里不再重复一份「最近会话」面板——本页卡片点进去是 `/chat/:agentId`，
 * 该页左栏就地切换会话（`?c=` 只留给后台完成提示那条深链）。
 */
const { t } = useI18n();

const agents = ref<AgentSummary[]>([]);
const searchKeyword = ref('');
const favorites = ref<string[]>([]);
const loading = ref(true);
const loadError = ref(false);

async function load() {
    loading.value = true;
    loadError.value = false;
    try {
        // 只认字符串数组：存进 localStorage 的值可能被其他页/旧版本写成 null 或对象，
        // 非数组会让下方 favorites.includes 抛 TypeError，整页渲染崩溃
        const raw = JSON.parse(localStorage.getItem('favorite_agents') || '[]');
        favorites.value = Array.isArray(raw) ? raw.filter((f): f is string => typeof f === 'string') : [];
    } catch {
        favorites.value = [];
    }
    try {
        agents.value = await $fetch<AgentSummary[]>('/api/agents');
    } catch {
        // 接口失败必须与「没有数据」区分，否则用户会把报错读成「暂无智能体」
        agents.value = [];
        loadError.value = true;
    } finally {
        loading.value = false;
    }
}

onMounted(load);

function toggleFavorite(id: string, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (favorites.value.includes(id)) {
        favorites.value = favorites.value.filter((f) => f !== id);
    } else {
        favorites.value.push(id);
    }
    try {
        localStorage.setItem('favorite_agents', JSON.stringify(favorites.value));
    } catch {
        // ignore
    }
}

const filteredAgents = computed(() => {
    const q = searchKeyword.value.trim().toLowerCase();
    let list = agents.value;
    if (q) {
        list = list.filter(
            (a) => a.name.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q) || a.skills?.some((s) => s.name.toLowerCase().includes(q)),
        );
    }
    // 收藏置顶排序
    return [...list].sort((a, b) => {
        const aFav = favorites.value.includes(a.id) ? 1 : 0;
        const bFav = favorites.value.includes(b.id) ? 1 : 0;
        return bFav - aFav;
    });
});
</script>

<template>
    <section class="min-w-0 space-y-4">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong flex items-center gap-2">
                    <span>{{ t('agents.title') }}</span>
                    <span class="app-chip app-chip-brand">
                        {{ filteredAgents.length }}
                    </span>
                </h1>
                <p class="app-page-subtitle">{{ t('agents.subtitle') }}</p>
            </div>

            <!-- 搜索栏与标题同级，收窄后贴在操作行右侧 -->
            <div class="relative w-full shrink-0 sm:w-64">
                <input
                    v-model="searchKeyword"
                    :placeholder="t('agents.searchPlaceholder')"
                    :aria-label="t('agents.searchPlaceholder')"
                    class="app-input !pl-9 !text-xs"
                />
                <span aria-hidden="true" class="text-faint absolute top-2.5 left-3 text-xs">🔍</span>
                <button
                    v-if="searchKeyword"
                    type="button"
                    :aria-label="t('chat.clearInput')"
                    class="text-faint text-hover-strong absolute top-1.5 right-1.5 p-1.5 text-xs"
                    @click="searchKeyword = ''"
                >
                    ✕
                </button>
            </div>
        </div>

        <!-- 加载失败：与「没有数据」区分，给出重试入口 -->
        <div v-if="loadError && !loading" class="app-card app-alert app-alert-danger flex items-center justify-between gap-3 !p-6 !text-xs">
            <span>{{ t('common.error') }}</span>
            <button type="button" class="app-btn app-btn-outline shrink-0 !py-1.5" @click="load">{{ t('common.retry') }}</button>
        </div>

        <!-- 首屏骨架：避免加载期间只剩一片空白 -->
        <div v-else-if="loading && !filteredAgents.length" class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div v-for="n in 6" :key="n" class="app-skeleton app-skeleton-card" />
        </div>

        <!-- 智能体网格卡片：主体宽度足够，三列铺开 -->
        <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <NuxtLink
                v-for="agent in filteredAgents"
                :key="agent.id"
                :to="`/chat/${agent.id}`"
                class="app-card app-card-hover group relative flex flex-col p-5"
            >
                <!-- 收藏：整块热区，已收藏时常亮高亮（不再另加文字标签） -->
                <button
                    type="button"
                    class="absolute top-3.5 right-3.5 flex h-8 w-8 items-center justify-center rounded-full text-base transition-all active:scale-90"
                    :class="
                        favorites.includes(agent.id)
                            ? 'bg-[color:var(--surface-3)] text-[color:var(--warning)]'
                            : 'text-faint text-hover-muted hover:bg-[color:var(--surface-3)]'
                    "
                    :aria-pressed="favorites.includes(agent.id)"
                    :title="favorites.includes(agent.id) ? t('common.cancel') : t('agents.topPin')"
                    @click="(e) => toggleFavorite(agent.id, e)"
                >
                    ★
                </button>

                <div class="flex items-center gap-3 pr-8">
                    <div class="app-avatar-icon h-11 w-11 shrink-0 text-2xl transition-transform group-hover:scale-105">
                        {{ agent.emoji || agent.avatar || '🤖' }}
                    </div>
                    <p class="group-hover-brand min-w-0 truncate text-sm font-bold transition-colors">{{ agent.name }}</p>
                </div>

                <p class="text-muted-2 mt-3 line-clamp-2 min-h-10 flex-1 text-xs leading-relaxed">{{ agent.description || t('common.none') }}</p>

                <!-- 技能标签收敛成一行并弱化，主行动点交给下方按钮 -->
                <div v-if="agent.skills?.length" class="mt-3 flex gap-1.5 overflow-hidden">
                    <span v-for="s in agent.skills.slice(0, 2)" :key="s.id" class="app-chip shrink-0 !px-2 !text-[9px]">
                        {{ s.name }}
                    </span>
                    <span v-if="agent.skills.length > 2" class="app-chip shrink-0 !px-2 !text-[9px]">+{{ agent.skills.length - 2 }}</span>
                </div>

                <span class="app-btn app-btn-sm app-btn-block app-card-cta mt-4">
                    {{ t('agents.startChat') }}
                    <span aria-hidden="true">→</span>
                </span>
            </NuxtLink>

            <!-- 空态：区分「搜索无结果」与「平台暂无智能体」，各自给出下一步；加载失败时由上方错误横幅独占表达 -->
            <div v-if="!filteredAgents.length && !loading && !loadError" class="app-card col-span-full">
                <div class="app-empty">
                    <div class="app-empty-icon">{{ searchKeyword ? '🔍' : '🤖' }}</div>
                    <p class="app-empty-title">{{ searchKeyword ? t('agents.noAgents') : t('agents.emptyPlaza') }}</p>
                    <p class="app-empty-desc">{{ searchKeyword ? t('agents.tryOtherKeyword') : t('agents.emptyPlazaDesc') }}</p>
                    <button v-if="searchKeyword" type="button" class="app-btn app-btn-outline app-btn-sm mt-2" @click="searchKeyword = ''">
                        {{ t('agents.clearSearch') }}
                    </button>
                </div>
            </div>
        </div>
    </section>
</template>
