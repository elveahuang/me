<script setup lang="ts">
import { formatDate, type NewsListResponse, type NewsSummary } from '@commons/contract';
import { IonContent, IonHeader, IonRefresher, IonRefresherContent, IonSearchbar, IonTitle, IonToolbar } from '@ionic/vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, extractApiError } from '../api/auth';
import BulletinBanner from '../components/BulletinBanner.vue';
import PageShell from './PageShell.vue';

const { t } = useI18n();

const items = ref<NewsSummary[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;
const loading = ref(false);
const error = ref('');
const keyword = ref('');
const category = ref('all');

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

/** 分类切换、搜索防抖与下拉刷新共用 load()：先发后回的旧响应会把上一个条件的列表写回来 */
let loadSeq = 0;

async function load(reset = false) {
    const seq = ++loadSeq;
    if (reset) page.value = 1;
    loading.value = true;
    error.value = '';
    try {
        const query = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
        if (category.value !== 'all') query.set('category', category.value);
        if (keyword.value.trim()) query.set('keyword', keyword.value.trim());
        const res = await api<NewsListResponse>(`/api/news?${query.toString()}`);
        if (seq !== loadSeq) return;
        items.value = res.items;
        total.value = res.total;
    } catch (e) {
        // 失败时清空列表：否则列表走空态，"接口挂了"会被读成"没有内容"
        items.value = [];
        error.value = extractApiError(e, t('common.error'));
    } finally {
        if (seq === loadSeq) loading.value = false;
    }
}

async function handleRefresh(event: CustomEvent) {
    await load(true);
    (event.target as HTMLIonRefresherElement).complete();
}

onMounted(() => load(true));

/** 搜索防抖；卸载时清理，避免页面销毁后仍触发请求 */
let timer: ReturnType<typeof setTimeout> | null = null;
function onSearch() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void load(true), 300);
}
onUnmounted(() => {
    if (timer) clearTimeout(timer);
});
</script>

<template>
    <PageShell>
        <ion-header class="ion-no-border">
            <ion-toolbar>
                <ion-title class="!text-lg font-black">{{ t('news.title') }}</ion-title>
            </ion-toolbar>
            <ion-toolbar class="px-2">
                <ion-searchbar v-model="keyword" :placeholder="t('common.search')" :debounce="300" class="p-0 text-xs" @ion-input="onSearch" />
            </ion-toolbar>
        </ion-header>

        <ion-content>
            <template v-slot:fixed>
                <ion-refresher @ion-refresh="handleRefresh">
                    <ion-refresher-content :pulling-text="t('common.pullToRefresh')" refreshing-spinner="crescent" />
                </ion-refresher>
            </template>

            <BulletinBanner position="global" />

            <div class="space-y-3 p-4">
                <div v-if="error" class="app-alert app-alert-danger flex items-center justify-between gap-2 text-[11px]">
                    <span>{{ error }}</span>
                    <button type="button" class="app-btn app-btn-soft shrink-0 !px-3 !py-1 !text-[10px]" @click="load(true)">
                        {{ t('common.retry') }}
                    </button>
                </div>

                <div v-if="loading && !items.length" class="space-y-3">
                    <div v-for="i in 4" :key="i" class="app-skeleton h-40" />
                </div>

                <div v-else-if="items.length" class="space-y-3">
                    <router-link
                        v-for="item in items"
                        :key="item.id"
                        :to="`/news/${item.id}`"
                        class="app-card app-card-hover block overflow-hidden transition-transform active:scale-[0.98]"
                    >
                        <div class="relative h-36 bg-[color:var(--surface-3)]">
                            <img v-if="item.coverImage" :src="item.coverImage" :alt="item.title" class="h-full w-full object-cover" />
                            <div v-else class="text-faint flex h-full items-center justify-center text-3xl">📰</div>
                            <span v-if="item.pinned" class="absolute top-2 left-2 rounded-full bg-amber-500/90 px-2 py-0.5 text-[9px] font-bold text-white">
                                {{ t('agents.topPin') }}</span
                            >
                        </div>
                        <div class="p-3">
                            <h3 class="line-clamp-2 text-xs font-black">{{ item.title }}</h3>
                            <p class="text-muted-2 mt-1 line-clamp-2 text-[10px] leading-relaxed">{{ item.summary || t('common.none') }}</p>
                            <div class="text-faint mt-2 flex items-center justify-between text-[9px]">
                                <span>{{ formatDate(item.publishedAt || item.createdAt) }}</span>
                                <span>👁 {{ item.viewCount }}</span>
                            </div>
                        </div>
                    </router-link>
                </div>

                <div v-else-if="!error" class="text-faint py-16 text-center text-xs">
                    <p class="mb-2 text-3xl">📰</p>
                    <p class="font-bold">{{ t('news.empty') }}</p>
                    <p class="mt-1">{{ t('news.emptyHint') }}</p>
                </div>

                <div v-if="totalPages > 1" class="flex items-center justify-center gap-3 pt-2 text-xs">
                    <button
                        type="button"
                        class="app-btn app-btn-outline !px-3 !py-1"
                        :disabled="page <= 1"
                        @click="
                            page -= 1;
                            load();
                        "
                    >
                        ‹
                    </button>
                    <span>{{ page }} / {{ totalPages }}</span>
                    <button
                        type="button"
                        class="app-btn app-btn-outline !px-3 !py-1"
                        :disabled="page >= totalPages"
                        @click="
                            page += 1;
                            load();
                        "
                    >
                        ›
                    </button>
                </div>
            </div>
        </ion-content>
    </PageShell>
</template>
