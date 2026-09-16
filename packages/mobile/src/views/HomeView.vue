<script setup lang="ts">
import type { AgentSummary } from '@contract';
import { IonContent, IonHeader, IonRefresher, IonRefresherContent, IonSearchbar, IonTitle, IonToolbar } from '@ionic/vue';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, extractApiError, fetchSession } from '../api/auth';
import { useTheme } from '../composables/useTheme';
import PageShell from './PageShell.vue';

const { t } = useI18n();
const { toggleMode } = useTheme();

const agents = ref<AgentSummary[]>([]);
const searchKeyword = ref('');
const loading = ref(false);
const error = ref('');
const favorites = ref<string[]>([]);
const userName = ref('');

async function loadAgents() {
    loading.value = true;
    error.value = '';
    try {
        agents.value = await api<AgentSummary[]>('/api/agents');
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    } finally {
        loading.value = false;
    }
}

async function handleRefresh(event: CustomEvent) {
    await loadAgents();
    (event.target as HTMLIonRefresherElement).complete();
}

onMounted(async () => {
    try {
        favorites.value = JSON.parse(localStorage.getItem('mobile_favorite_agents') || '[]');
    } catch {
        favorites.value = [];
    }
    loadAgents();
    const session = await fetchSession();
    userName.value = session?.user?.name ?? '';
});

const activeCategory = ref('all');

function toggleFavorite(id: string, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (favorites.value.includes(id)) {
        favorites.value = favorites.value.filter((f) => f !== id);
    } else {
        favorites.value.push(id);
    }
    try {
        localStorage.setItem('mobile_favorite_agents', JSON.stringify(favorites.value));
    } catch {
        // ignore
    }
}

const filteredAgents = computed(() => {
    const q = searchKeyword.value.trim().toLowerCase();
    let list = agents.value;

    // 分类筛选
    if (activeCategory.value === 'favorites') {
        list = list.filter((a) => favorites.value.includes(a.id));
    } else if (activeCategory.value === 'writing') {
        list = list.filter((a) => /写作|文案|翻译|创作|write|copy/i.test(a.name + (a.description || '')));
    } else if (activeCategory.value === 'coding') {
        list = list.filter((a) => /代码|编程|开发|code|dev|python|sql/i.test(a.name + (a.description || '')));
    } else if (activeCategory.value === 'productivity') {
        list = list.filter((a) => /效率|总结|分析|助理|tool|plan/i.test(a.name + (a.description || '')));
    }

    if (q) {
        list = list.filter(
            (a) => a.name.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q) || a.skills?.some((s) => s.name.toLowerCase().includes(q)),
        );
    }
    // 收藏置顶
    return [...list].sort((a, b) => {
        const aFav = favorites.value.includes(a.id) ? 1 : 0;
        const bFav = favorites.value.includes(b.id) ? 1 : 0;
        return bFav - aFav;
    });
});
</script>

<template>
    <PageShell>
        <ion-header class="ion-no-border">
            <ion-toolbar>
                <ion-title class="!text-lg font-black">{{ userName ? `${userName}，你好 👋` : t('agents.title') }}</ion-title>
                <template v-slot:end>
                    <button type="button" class="app-btn app-btn-ghost mr-1 !px-2.5" title="切换深浅色" @click="toggleMode">🌓</button>
                </template>
            </ion-toolbar>
            <ion-toolbar class="px-2">
                <ion-searchbar v-model="searchKeyword" :placeholder="t('agents.searchPlaceholder')" :debounce="200" class="p-0 text-xs" />
            </ion-toolbar>
            <!-- 分类滑动胶囊栏 -->
            <div class="no-scrollbar flex items-center gap-1.5 overflow-x-auto px-4 pb-2 text-xs">
                <button
                    v-for="cat in [
                        { key: 'all', label: t('agents.categoryAll') },
                        { key: 'favorites', label: '★ ' + t('agents.categoryFavorites') },
                        { key: 'writing', label: '✍️ ' + t('agents.categoryWriting') },
                        { key: 'coding', label: '💻 ' + t('agents.categoryCoding') },
                        { key: 'productivity', label: '⚡ ' + t('agents.categoryProductivity') },
                    ]"
                    :key="cat.key"
                    type="button"
                    :class="[
                        'shrink-0 rounded-full px-3 py-1 font-bold transition-all active:scale-95',
                        activeCategory === cat.key ? 'bg-primary-600 text-white shadow-xs' : 'bg-surface-2 text-muted hover:bg-surface-3',
                    ]"
                    @click="activeCategory = cat.key"
                >
                    {{ cat.label }}
                </button>
            </div>
        </ion-header>

        <ion-content>
            <template v-slot:fixed>
                <ion-refresher @ion-refresh="handleRefresh">
                    <ion-refresher-content pulling-text="下拉刷新" refreshing-spinner="crescent" />
                </ion-refresher>
            </template>

            <div class="p-4">
                <p class="text-faint mb-3 text-[11px]">{{ t('agents.subtitle') }}</p>

                <div v-if="error" class="app-alert app-alert-danger mb-3">{{ error }}</div>

                <div class="grid grid-cols-2 gap-3">
                    <router-link
                        v-for="agent in filteredAgents"
                        :key="agent.id"
                        :to="`/chat/${agent.id}`"
                        class="app-card app-card-hover relative flex flex-col justify-between p-4 transition-transform active:scale-[0.97]"
                    >
                        <button
                            type="button"
                            class="absolute top-3 right-3 p-1 text-sm leading-none transition-transform active:scale-90"
                            :class="favorites.includes(agent.id) ? 'text-[color:var(--warning)]' : 'text-faint'"
                            @click="(e) => toggleFavorite(agent.id, e)"
                        >
                            ★
                        </button>

                        <div>
                            <div class="flex items-center gap-2 pr-5">
                                <span class="app-avatar-icon h-9 w-9 shrink-0 text-xl">{{ agent.emoji || agent.avatar || '🤖' }}</span>
                                <div class="min-w-0 flex-1">
                                    <span class="block truncate text-xs font-bold">{{ agent.name }}</span>
                                    <span v-if="favorites.includes(agent.id)" class="text-[9px] font-extrabold text-[color:var(--warning)]">
                                        {{ t('agents.topPin') }}
                                    </span>
                                </div>
                            </div>
                            <p class="text-muted-2 mt-2 line-clamp-2 text-[11px] leading-relaxed">{{ agent.description || t('common.none') }}</p>
                        </div>

                        <div v-if="agent.skills?.length" class="mt-3 flex flex-wrap gap-1">
                            <span v-for="s in agent.skills.slice(0, 2)" :key="s.id" class="app-chip !text-[9px]"> {{ s.name }} </span>
                            <span v-if="agent.skills.length > 2" class="text-faint text-[9px]">+{{ agent.skills.length - 2 }}</span>
                        </div>
                    </router-link>
                </div>

                <!-- 骨架屏 -->
                <div v-if="loading && !agents.length" class="grid grid-cols-2 gap-3">
                    <div v-for="i in 4" :key="i" class="app-skeleton h-32" />
                </div>

                <div v-if="!filteredAgents.length && !loading" class="text-faint py-16 text-center text-xs">
                    <p class="mb-2 text-3xl">🔍</p>
                    <p class="font-bold text-slate-700 dark:text-slate-300">{{ t('agents.noAgents') }}</p>
                    <button
                        v-if="searchKeyword || activeCategory !== 'all'"
                        type="button"
                        class="bg-surface-3 text-primary-600 mt-3 rounded-xl px-3 py-1.5 font-bold transition-transform active:scale-95"
                        @click="
                            searchKeyword = '';
                            activeCategory = 'all';
                        "
                    >
                        {{ t('agents.resetFilter') }}
                    </button>
                </div>
            </div>
        </ion-content>
    </PageShell>
</template>
