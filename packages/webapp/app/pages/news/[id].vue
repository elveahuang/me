<script setup lang="ts">
import { extractApiError, formatDate, type NewsArticle, type NewsSummary } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ middleware: 'auth' });

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const article = ref<(NewsArticle & { related?: NewsSummary[] }) | null>(null);
const loading = ref(true);
const error = ref('');

async function load(id: string) {
    loading.value = true;
    error.value = '';
    try {
        article.value = await $fetch(`/api/news/${id}`);
    } catch (e) {
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(() => load(String(route.params.id)));
watch(
    () => route.params.id,
    (next) => next && load(String(next)),
);

useHead({
    title: () => (article.value ? `${article.value.title} - EE` : 'EE'),
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
