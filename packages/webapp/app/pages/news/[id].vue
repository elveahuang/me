<script setup lang="ts">
import { extractApiError, formatDate, type NewsDetailResponse } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ middleware: 'auth' });

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const article = ref<NewsDetailResponse | null>(null);
const loading = ref(true);
const error = ref('');

/** 详情请求按 id 发序：A→B 途中回退到 A 时，B 的迟到响应必须丢弃，否则会把 B 的正文渲染在 A 的地址下 */
let loadSeq = 0;

async function load(id: string) {
    const seq = ++loadSeq;
    loading.value = true;
    error.value = '';
    try {
        const res = await $fetch<NewsDetailResponse>(`/api/news/${id}`);
        if (seq !== loadSeq) return;
        article.value = res;
    } catch (e) {
        if (seq !== loadSeq) return;
        // 清掉上一篇：否则失败时 article 仍是别篇文章，容易在错误提示之外残留错内容
        article.value = null;
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        if (seq === loadSeq) loading.value = false;
    }
}

// 用 useAsyncData 承载首屏请求：SSR 拉取后客户端复用同一份 payload，不会二次请求。
// 浏览量按 (用户, 文章) 半小时去重，因此即使重复调用也不会虚增计数。
const { data: initial } = await useAsyncData(`news-${route.params.id}`, () => $fetch<NewsDetailResponse>(`/api/news/${route.params.id}`).catch(() => null));

if (initial.value) {
    article.value = initial.value;
    loading.value = false;
}

async function reload() {
    const id = String(route.params.id);
    // 首屏已由 useAsyncData 填充，仅在切换文章时重新请求。
    // 必须同时要求「当前没有在途请求」：A→B 未完成就退回 A 时，article 仍是 A，
    // 只看 id 会直接 return，让 B 的响应落在 A 的地址上。
    if (article.value?.id === id && !loading.value) return;
    await load(id);
}

onMounted(reload);
watch(
    () => route.params.id,
    () => void reload(),
);

useHead({
    title: () => (article.value ? `${article.value.title} - ME` : 'ME'),
});
</script>

<template>
    <div class="mx-auto max-w-3xl space-y-6">
        <button type="button" class="app-btn app-btn-ghost !px-2" @click="router.push('/news')">
            <AppIcon name="arrow-left" :size="16" />
            <span>{{ t('news.backToList') }}</span>
        </button>

        <div v-if="loading" class="space-y-3">
            <div class="app-skeleton h-8 w-2/3" />
            <div class="app-skeleton h-52 w-full" />
            <div class="app-skeleton h-32 w-full" />
        </div>

        <div v-else-if="error" class="app-alert app-alert-danger">{{ error }}</div>

        <article v-else-if="article" class="space-y-5">
            <header class="space-y-3">
                <div class="flex flex-wrap items-center gap-2">
                    <span v-if="article.pinned" class="app-chip app-chip-brand !text-[10px]">
                        <AppIcon name="pin-outline" :size="11" />
                        <span>{{ t('agents.topPin') }}</span>
                    </span>
                    <span class="app-chip !text-[10px]">{{ article.category }}</span>
                    <span v-for="tag in article.tags" :key="tag" class="app-chip !text-[10px]">{{ tag }}</span>
                </div>
                <h1 class="text-2xl font-black tracking-tight sm:text-3xl">{{ article.title }}</h1>
                <div class="text-faint flex items-center gap-4 text-xs">
                    <span>{{ t('news.publishedAt') }}：{{ formatDate(article.publishedAt || article.createdAt) }}</span>
                    <span class="inline-flex items-center gap-1">
                        <AppIcon name="eye-outline" :size="13" />
                        <span>{{ article.viewCount }} {{ t('news.views') }}</span>
                    </span>
                </div>
            </header>

            <img v-if="article.coverImage" :src="article.coverImage" :alt="article.title" class="max-h-96 w-full rounded-2xl object-cover" />

            <div v-if="article.summary" class="app-panel text-muted-2 p-4 text-xs leading-relaxed">{{ article.summary }}</div>

            <MarkdownContent :value="article.content" />

            <section v-if="article.related?.length" class="app-divider space-y-3 pt-5">
                <h2 class="text-sm font-black">{{ t('news.relatedTitle') }}</h2>
                <div class="grid gap-3 sm:grid-cols-2">
                    <NuxtLink v-for="item in article.related" :key="item.id" :to="`/news/${item.id}`" class="app-card app-card-hover p-3">
                        <p class="line-clamp-2 text-xs font-bold">{{ item.title }}</p>
                        <p class="text-faint mt-1.5 text-[10px]">{{ formatDate(item.publishedAt || item.createdAt) }}</p>
                    </NuxtLink>
                </div>
            </section>
        </article>
    </div>
</template>
