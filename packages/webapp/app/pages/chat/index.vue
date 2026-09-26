<script setup lang="ts">
import { extractApiError, formatDate, type AgentSummary, type ConversationSummary } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ middleware: 'auth' });

const { t } = useI18n();

const agents = ref<AgentSummary[]>([]);
const conversations = ref<ConversationSummary[]>([]);
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
        const [agentRes, convRes] = await Promise.all([$fetch<AgentSummary[]>('/api/agents'), $fetch<ConversationSummary[]>('/api/conversations')]);
        agents.value = agentRes;
        conversations.value = convRes;
    } catch {
        // 接口失败必须与「没有数据」区分，否则用户会把报错读成「暂无智能体」
        agents.value = [];
        conversations.value = [];
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

/** 删除会话失败的就地提示：面板常驻，靠 showTransient 的超时自动清除 */
const { error: listError, show: showListError } = useTransientError();

async function removeConversation(id: string) {
    if (!confirm(t('chat.deleteConfirm'))) return;
    try {
        await $fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
        conversations.value = conversations.value.filter((c) => c.id !== id);
    } catch (e) {
        showListError(extractApiError(e, t('common.error')));
    }
}
</script>

<template>
    <!-- 紧凑左右栏：会话历史固定 272px 侧栏，智能体广场作为主体居中铺开 -->
    <div class="grid grid-cols-1 gap-5 lg:grid-cols-[272px_minmax(0,1fr)] lg:gap-6">
        <!-- 最近会话历史列表 -->
        <aside class="order-2 min-w-0 lg:order-1">
            <div class="app-panel flex flex-col overflow-hidden lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)]">
                <h2 class="flex shrink-0 items-center justify-between px-4 py-3.5 text-sm font-black">
                    <span>{{ t('nav.conversations') }}</span>
                    <span class="app-chip">{{ conversations.length }}</span>
                </h2>

                <div v-if="listError" class="app-alert app-alert-danger !text-xs">{{ listError }}</div>

                <ul class="border-line max-h-[22rem] space-y-1.5 overflow-y-auto border-t px-2 pb-2 lg:max-h-none">
                    <li v-if="loading" class="space-y-1.5 py-1.5">
                        <div v-for="n in 4" :key="n" class="app-skeleton h-11 !rounded-xl" />
                    </li>
                    <li v-for="c in conversations" :key="c.id" class="group relative rounded-xl transition-colors hover:bg-[color:var(--surface-2)]">
                        <NuxtLink :to="`/chat/${c.agentId}?c=${c.id}`" class="block min-w-0 py-2.5 pr-8 pl-2.5 text-xs">
                            <p class="group-hover-brand truncate font-semibold transition-colors">{{ c.title }}</p>
                            <p class="text-faint mt-1 flex items-center gap-1.5 text-[10px]">
                                <span class="truncate">{{ c.agentName }}</span>
                                <span>·</span>
                                <span class="whitespace-nowrap">{{ formatDate(c.updatedAt) }}</span>
                            </p>
                        </NuxtLink>
                        <button
                            type="button"
                            class="app-hover-reveal text-faint text-hover-danger absolute top-1/2 right-1.5 block -translate-y-1/2 rounded-md p-2 transition-colors"
                            :title="t('chat.deleteChat')"
                            :aria-label="t('chat.deleteChat')"
                            @click="removeConversation(c.id)"
                        >
                            ✕
                        </button>
                    </li>
                    <li v-if="!conversations.length && !loading && !loadError">
                        <div class="app-empty !px-2 !py-9">
                            <div class="app-empty-icon !h-11 !w-11 !text-lg">💬</div>
                            <p class="app-empty-title !text-xs">{{ t('chat.sidebarEmptyTitle') }}</p>
                            <p class="app-empty-desc">{{ t('chat.sidebarEmptyDesc') }}</p>
                        </div>
                    </li>
                </ul>
            </div>
        </aside>

        <!-- 智能体广场列表 -->
        <section class="order-1 min-w-0 space-y-4 lg:order-2">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 class="flex items-center gap-2 text-xl font-black">
                        <span>{{ t('agents.title') }}</span>
                        <span class="app-chip app-chip-brand">
                            {{ filteredAgents.length }}
                        </span>
                    </h1>
                    <p class="text-muted-2 mt-1 text-xs">{{ t('agents.subtitle') }}</p>
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
    </div>
</template>
