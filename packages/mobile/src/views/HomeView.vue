<script setup lang="ts">
import type { AgentSummary } from '@commons/contract';
import { IonContent, IonHeader, IonRefresher, IonRefresherContent, IonSearchbar, IonTitle, IonToolbar, onIonViewWillEnter } from '@ionic/vue';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, extractApiError, fetchSession } from '../api/auth';
import BulletinBanner from '../components/BulletinBanner.vue';
import { useTheme } from '../composables/useTheme';
import { useUnread } from '../composables/useUnread';
import PageShell from './PageShell.vue';

const { t } = useI18n();
const { toggleMode } = useTheme();
const { unread, refresh: refreshUnread } = useUnread();

const agents = ref<AgentSummary[]>([]);
const searchKeyword = ref('');
const loading = ref(true); // 首帧即加载态：数据要等 onMounted/onIonViewWillEnter 之后的请求，初值 false 会让「暂无…」空态先闪一帧
const error = ref('');
const favorites = ref<string[]>([]);
const userName = ref('');

/** 下拉刷新与标签页回场刷新并发：先发后回的旧响应会把新列表写回去（与附件/通知页同用序号守卫） */
let loadSeq = 0;

async function loadAgents() {
    const seq = ++loadSeq;
    loading.value = true;
    error.value = '';
    try {
        const res = await api<AgentSummary[]>('/api/agents');
        if (seq !== loadSeq) return;
        agents.value = res;
    } catch (e) {
        if (seq !== loadSeq) return;
        // 失败时清空列表：否则只剩空态文案，"接口挂了"会被读成"还没有智能体"
        agents.value = [];
        error.value = extractApiError(e, t('common.error'));
    } finally {
        if (seq === loadSeq) loading.value = false;
    }
}

async function handleRefresh(event: CustomEvent) {
    await loadAgents();
    (event.target as HTMLIonRefresherElement).complete();
}

onMounted(() => {
    try {
        // 与 BulletinBanner / Web 端 chat/index 同一护栏：localStorage 里可能是任何合法 JSON
        // （旧版本或手工改动），try/catch 只挡住解析失败。存进 null/数字/对象时
        // favorites.includes(...) 会在渲染期抛 TypeError，整个首页白屏。
        const raw = JSON.parse(localStorage.getItem('mobile_favorite_agents') || '[]');
        favorites.value = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch {
        favorites.value = [];
    }
});

// Ionic 标签页组件会随切换保活，onMounted 只在首次触发；
// 每次进入 Home 标签时刷新列表/角标/昵称，避免从聊天等页面返回后看到旧数据。
onIonViewWillEnter(() => {
    loadAgents();
    void refreshUnread();
    void loadUserName();
});

async function loadUserName() {
    const session = await fetchSession();
    userName.value = session?.user?.name ?? '';
}

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
                <ion-title class="!text-lg font-black">{{ userName ? t('agents.greeting', { name: userName }) : t('agents.title') }}</ion-title>
                <template v-slot:end>
                    <router-link to="/news" class="app-btn app-btn-ghost mr-1 !px-2.5" :title="t('nav.news')" :aria-label="t('nav.news')">📰</router-link>
                    <router-link
                        to="/notifications"
                        class="app-btn app-btn-ghost relative mr-1 !px-2.5"
                        :title="t('nav.notifications')"
                        :aria-label="t('nav.notifications')"
                    >
                        🔔
                        <span v-if="unread" class="app-badge app-badge-danger absolute -top-0.5 right-0 h-4 min-w-4 justify-center !px-1 !text-[9px]">
                            {{ unread > 99 ? '99+' : unread }}
                        </span>
                    </router-link>
                    <button
                        type="button"
                        class="app-btn app-btn-ghost mr-1 !px-2.5"
                        :title="t('chat.toggleTheme')"
                        :aria-label="t('chat.toggleTheme')"
                        @click="toggleMode"
                    >
                        🌓
                    </button>
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
                        activeCategory === cat.key ? 'bg-brand shadow-xs' : 'bg-surface-2 text-muted hover:bg-[color:var(--surface-3)]',
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
                    <ion-refresher-content :pulling-text="t('common.pullToRefresh')" refreshing-spinner="crescent" />
                </ion-refresher>
            </template>

            <div class="p-4">
                <BulletinBanner position="home" />
                <p class="text-faint mb-3 text-[11px]">{{ t('agents.subtitle') }}</p>

                <div v-if="error" class="app-alert app-alert-danger mb-3 flex items-center justify-between gap-2 !text-[11px]">
                    <span>{{ error }}</span>
                    <button type="button" class="app-btn app-btn-soft shrink-0 !px-3 !py-1 !text-[10px]" @click="loadAgents()">
                        {{ t('common.retry') }}
                    </button>
                </div>

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
                            :aria-label="t('common.favorite')"
                            :aria-pressed="favorites.includes(agent.id)"
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

                <!-- 失败时不渲染空态：否则「还没有智能体」会把「接口挂了」读成「真的没有数据」 -->
                <div v-if="!filteredAgents.length && !loading && !error" class="text-faint py-16 text-center text-xs">
                    <p class="mb-2 text-3xl">🔍</p>
                    <p class="text-strong font-bold">{{ t('agents.noAgents') }}</p>
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
