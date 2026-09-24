<script setup lang="ts">
import { formatDate, formatRelativeTime, type NewsDetailResponse } from '@commons/contract';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonRefresher, IonRefresherContent, IonTitle, IonToolbar } from '@ionic/vue';
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { api, extractApiError } from '../api/auth';
import MobileMarkdownContent from '../components/MobileMarkdownContent.vue';
import PageShell from './PageShell.vue';

const { t, locale } = useI18n();
const route = useRoute();

const article = ref<NewsDetailResponse | null>(null);
const loading = ref(true);
const error = ref('');

/** 切换文章与下拉刷新共用 load()：先发后回的旧响应会把上一篇的正文写回当前地址下 */
let loadSeq = 0;

async function load(id: string) {
    const seq = ++loadSeq;
    loading.value = true;
    error.value = '';
    try {
        // id 来自路由参数：vue-router 会把 %2F 解码成真正的 `/`，不编进单段的话
        // 一个深链就能让应用带着登录凭证去请求用户没选过的路径
        const res = await api<NewsDetailResponse>(`/api/news/${encodeURIComponent(id)}`);
        if (seq !== loadSeq) return;
        article.value = res;
    } catch (e) {
        if (seq !== loadSeq) return;
        // 清掉旧正文：失败时 article 仍属于另一篇文章，会和当前 URL 对不上
        article.value = null;
        error.value = extractApiError(e, t('common.error'));
    } finally {
        if (seq === loadSeq) loading.value = false;
    }
}

onMounted(() => load(String(route.params.id)));
watch(
    () => route.params.id,
    (next) => next && load(String(next)),
);

/** 下拉刷新：重新拉取正文与相关推荐 */
async function handleRefresh(event: CustomEvent) {
    await load(String(route.params.id));
    (event.target as HTMLIonRefresherElement).complete();
}
</script>

<template>
    <PageShell>
        <ion-header class="ion-no-border">
            <ion-toolbar>
                <!-- 原生返回语义：压栈式 router.push 会与侧滑/物理返回冲突（与 MembershipView 同规则） -->
                <template v-slot:start>
                    <ion-buttons>
                        <ion-back-button default-href="/news" text="" />
                    </ion-buttons>
                </template>
                <ion-title class="!text-sm font-black">{{ t('news.title') }}</ion-title>
            </ion-toolbar>
        </ion-header>

        <ion-content>
            <template v-slot:fixed>
                <ion-refresher @ion-refresh="handleRefresh">
                    <ion-refresher-content :pulling-text="t('common.pullToRefresh')" refreshing-spinner="crescent" />
                </ion-refresher>
            </template>

            <div class="space-y-4 p-4">
                <div v-if="loading" class="space-y-3">
                    <div class="app-skeleton h-7 w-3/4" />
                    <div class="app-skeleton h-44 w-full" />
                    <div class="app-skeleton h-28 w-full" />
                </div>

                <div v-else-if="error" class="app-alert app-alert-danger flex items-center justify-between gap-2 !text-[11px]">
                    <span>{{ error }}</span>
                    <button type="button" class="app-btn app-btn-soft shrink-0 !px-3 !py-1 !text-[10px]" @click="load(String(route.params.id))">
                        {{ t('common.retry') }}
                    </button>
                </div>

                <article v-else-if="article" class="space-y-4">
                    <div class="space-y-2">
                        <div class="flex flex-wrap items-center gap-1.5">
                            <span v-if="article.pinned" class="app-chip app-chip-brand !text-[9px]">{{ t('agents.topPin') }}</span>
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
                            <p class="text-faint mt-1 text-[9px]">{{ formatRelativeTime(item.publishedAt || item.createdAt, locale) }}</p>
                        </router-link>
                    </div>
                </article>
            </div>
        </ion-content>
    </PageShell>
</template>
