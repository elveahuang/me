<script setup lang="ts">
import { formatDate, formatRelativeTime, type NewsArticle, type NewsSummary } from '@commons/contract';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/vue';
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { api, extractApiError } from '../api/auth';
import PageShell from './PageShell.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const article = ref<(NewsArticle & { related?: NewsSummary[] }) | null>(null);
const loading = ref(true);
const error = ref('');

async function load(id: string) {
    loading.value = true;
    error.value = '';
    try {
        article.value = await api<NewsArticle & { related?: NewsSummary[] }>(`/api/news/${id}`);
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    } finally {
        loading.value = false;
    }
}

onMounted(() => load(String(route.params.id)));
watch(
    () => route.params.id,
    (next) => next && load(String(next)),
);
</script>

<template>
    <PageShell>
        <ion-header class="ion-no-border">
            <ion-toolbar>
                <button type="button" class="app-btn app-btn-ghost !px-2" @click="router.push('/news')">‹</button>
                <ion-title class="!text-sm font-black">{{ t('news.title') }}</ion-title>
            </ion-toolbar>
        </ion-header>

        <ion-content>
            <div class="space-y-4 p-4">
                <div v-if="loading" class="space-y-3">
                    <div class="app-skeleton h-7 w-3/4" />
                    <div class="app-skeleton h-44 w-full" />
                    <div class="app-skeleton h-28 w-full" />
                </div>

                <div v-else-if="error" class="app-alert app-alert-danger text-[11px]">{{ error }}</div>

                <article v-else-if="article" class="space-y-4">
                    <div class="space-y-2">
                        <div class="flex flex-wrap items-center gap-1.5">
                            <span v-if="article.pinned" class="rounded-full bg-amber-500/90 px-2 py-0.5 text-[9px] font-bold text-white">置顶</span>
                            <span class="app-chip !text-[9px]">{{ article.category }}</span>
                            <span v-for="tag in article.tags" :key="tag" class="app-chip !text-[9px]">{{ tag }}</span>
                        </div>
                        <h1 class="text-base leading-snug font-black">{{ article.title }}</h1>
                        <div class="text-faint flex items-center gap-3 text-[10px]">
                            <span>{{ formatDate(article.publishedAt || article.createdAt) }}</span>
                            <span>👁 {{ article.viewCount }}</span>
                        </div>
                    </div>

                    <img v-if="article.coverImage" :src="article.coverImage" :alt="article.title" class="max-h-72 w-full rounded-xl object-cover" />

                    <p v-if="article.summary" class="text-muted-2 rounded-xl bg-[color:var(--surface-3)] p-3 text-[11px] leading-relaxed">
                        {{ article.summary }}
                    </p>

                    <!-- 正文：移动端沿用聊天的 Markdown 渲染能力（Comark） -->
                    <MobileMarkdownContent :value="article.content" />

                    <div v-if="article.related?.length" class="space-y-2 border-t pt-4" style="border-color: var(--line)">
                        <h2 class="text-xs font-black">{{ t('news.relatedTitle') }}</h2>
                        <router-link v-for="item in article.related" :key="item.id" :to="`/news/${item.id}`" class="app-card app-card-hover block p-3">
                            <p class="line-clamp-2 text-[11px] font-bold">{{ item.title }}</p>
                            <p class="text-faint mt-1 text-[9px]">{{ formatRelativeTime(item.publishedAt || item.createdAt) }}</p>
                        </router-link>
                    </div>
                </article>
            </div>
        </ion-content>
    </PageShell>
</template>
