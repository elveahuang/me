<script setup lang="ts">
import { extractApiError, formatDate, type NewsListResponse, type NewsSummary } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ middleware: 'auth' });

const { t } = useI18n();

const items = ref<NewsSummary[]>([]);
const categories = ref<{ value: string; count: number }[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 9;
const loading = ref(false);
const error = ref('');
const keyword = ref('');
const category = ref('all');

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

/** 筛选/搜索/翻页都会重发 load，而 load 是在调用时读取这些状态的：
 *  先发后回的旧请求会把上一页的条目和 total 写回来，出现「高亮的分类是新的、列表是旧的」。 */
let loadSeq = 0;

async function load() {
    const seq = ++loadSeq;
    loading.value = true;
    error.value = '';
    try {
        const res = await $fetch<NewsListResponse>('/api/news', {
            query: {
                page: page.value,
                pageSize,
                category: category.value === 'all' ? undefined : category.value,
                keyword: keyword.value || undefined,
            },
        });
        if (seq !== loadSeq) return;
        items.value = res.items;
        total.value = res.total;
        categories.value = res.categories ?? [];
    } catch (e) {
        if (seq !== loadSeq) return;
        // 失败时必须清空列表：否则模板里 items.length 仍为真，接口挂了会被读成「筛选后就是这些结果」
        items.value = [];
        total.value = 0;
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        if (seq === loadSeq) loading.value = false;
    }
}

onMounted(load);

/** 搜索防抖；卸载时清理，避免组件销毁后仍触发请求 */
let timer: ReturnType<typeof setTimeout> | null = null;
watch(keyword, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        page.value = 1;
        void load();
    }, 300);
});
onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
});

watch(category, () => {
    page.value = 1;
    void load();
});

function goPage(next: number) {
    if (next < 1 || next > totalPages.value) return;
    page.value = next;
    void load();
}
</script>

<template>
    <div class="space-y-6">
        <!-- 全站宣传栏由 default 布局统一渲染，这里不再重复放置，避免同一内容出现两次 -->
        <div>
            <h1 class="text-2xl font-black tracking-tight">{{ t('news.title') }}</h1>
            <p class="text-faint mt-1 text-xs">{{ t('news.subtitle') }}</p>
        </div>

        <div v-if="error" class="app-alert app-alert-danger flex items-center justify-between gap-3">
            <span>{{ error }}</span>
            <button type="button" class="app-btn app-btn-soft shrink-0 !px-3 !py-1 !text-[10px]" @click="load">{{ t('common.retry') }}</button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <div class="relative flex-1 sm:max-w-xs">
                <AppIcon name="magnify" :size="15" class="text-faint pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
                <input v-model="keyword" class="app-input !pl-8 !text-xs" :placeholder="t('common.search')" />
            </div>
            <button type="button" class="app-chip transition-colors" :class="category === 'all' ? 'app-chip-brand' : ''" @click="category = 'all'">
                {{ t('common.all') }}
            </button>
            <button
                v-for="c in categories"
                :key="c.value"
                type="button"
                class="app-chip transition-colors"
                :class="category === c.value ? 'app-chip-brand' : ''"
                @click="category = c.value"
            >
                {{ c.value }} ({{ c.count }})
            </button>
        </div>

        <div v-if="loading" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div v-for="i in 6" :key="i" class="app-skeleton h-56" />
        </div>

        <div v-else-if="items.length" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NuxtLink v-for="item in items" :key="item.id" :to="`/news/${item.id}`" class="app-card app-card-hover group flex flex-col overflow-hidden">
                <div class="relative h-40 overflow-hidden bg-[color:var(--surface-3)]">
                    <img
                        v-if="item.coverImage"
                        :src="item.coverImage"
                        :alt="item.title"
                        class="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                    <div v-else class="text-faint flex h-full items-center justify-center">
                        <AppIcon name="newspaper-variant-outline" :size="38" />
                    </div>
                    <span v-if="item.pinned" class="app-chip app-chip-brand absolute top-2 left-2 !text-[10px]">
                        <AppIcon name="pin-outline" :size="11" />
                        <span>{{ t('agents.topPin') }}</span>
                    </span>
                </div>
                <div class="flex flex-1 flex-col p-4">
                    <h2 class="group-text-hover-brand line-clamp-2 text-sm font-black transition-colors">{{ item.title }}</h2>
                    <p class="text-muted-2 mt-2 line-clamp-3 flex-1 text-[11px] leading-relaxed">{{ item.summary || t('common.none') }}</p>
                    <div class="app-divider mt-3 flex items-center justify-between pt-2 text-[10px]">
                        <span class="text-faint">{{ formatDate(item.publishedAt || item.createdAt) }}</span>
                        <span class="text-faint inline-flex items-center gap-1">
                            <AppIcon name="eye-outline" :size="12" />
                            <span>{{ item.viewCount }}</span>
                        </span>
                    </div>
                </div>
            </NuxtLink>
        </div>

        <!-- 失败时不渲染空态：否则「暂无资讯」会把「接口挂了」读成「真的没有内容」 -->
        <div v-else-if="!error" class="app-card flex flex-col items-center gap-2 p-12 text-center">
            <AppIcon name="newspaper-variant-outline" :size="34" class="text-faint" />
            <p class="text-sm font-bold">{{ t('news.empty') }}</p>
            <p class="text-faint text-xs">{{ t('news.emptyHint') }}</p>
        </div>

        <div v-if="totalPages > 1" class="flex items-center justify-center gap-2">
            <button type="button" class="app-btn app-btn-outline !px-3" :disabled="page <= 1" @click="goPage(page - 1)">
                <AppIcon name="chevron-left" :size="16" />
            </button>
            <span class="text-xs">{{ page }} / {{ totalPages }}</span>
            <button type="button" class="app-btn app-btn-outline !px-3" :disabled="page >= totalPages" @click="goPage(page + 1)">
                <AppIcon name="chevron-right" :size="16" />
            </button>
        </div>
    </div>
</template>
