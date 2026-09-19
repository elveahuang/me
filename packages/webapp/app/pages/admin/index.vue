<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

const { t } = useI18n();

interface RecentUser {
    id: string;
    name: string;
    email: string;
    role: string;
    createdAt: string;
}

interface RecentConv {
    id: string;
    title: string;
    agentName: string;
    agentEmoji: string | null;
    updatedAt: string;
}

interface ModelUsage {
    model: string;
    conversations: number;
}

interface StatsData {
    users: number;
    agents: number;
    conversations: number;
    skills: number;
    tools: number;
    providers: number;
    mcpServers: number;
    knowledgeBases: number;
    plans: number;
    orders: number;
    messages: number;
    activeConversations24h: number;
    recentUsers: RecentUser[];
    recentConversations: RecentConv[];
    modelUsage: ModelUsage[];
}

const stats = ref<StatsData | null>(null);
const loading = ref(true);
const loadError = ref('');

async function load() {
    loading.value = true;
    loadError.value = '';
    try {
        stats.value = await $fetch<StatsData>('/api/admin/stats');
    } catch (e) {
        // 失败时 stats 保持 null：若无提示，所有 KPI 会显示 0，
        // 看起来像「平台没有数据」而不是「接口挂了」
        stats.value = null;
        loadError.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

const maxModelCount = computed(() => {
    if (!stats.value?.modelUsage?.length) return 1;
    return Math.max(...stats.value.modelUsage.map((m) => m.conversations), 1);
});

interface StatCard {
    label: string;
    value: number;
    hint?: string;
}

// 主指标：业务规模与活跃度。数值一律深灰，颜色只留给错误/预警，不做装饰性配色
const primaryCards = computed<StatCard[]>(() => {
    const s = stats.value;
    if (!s) return [];
    return [
        { label: t('admin.usersCount'), value: s.users },
        { label: t('admin.active24h'), value: s.activeConversations24h, hint: `${t('admin.conversationsCount')} ${s.conversations}` },
        { label: t('admin.messagesCount'), value: s.messages },
        { label: t('admin.ordersCount'), value: s.orders, hint: `${t('admin.plansCount')} ${s.plans}` },
    ];
});

// 资产指标：平台配置规模，视觉上弱于主指标一档
const assetCards = computed<StatCard[]>(() => {
    const s = stats.value;
    if (!s) return [];
    return [
        { label: t('admin.agentsCount'), value: s.agents, hint: `${s.skills} Skill · ${s.tools} Tool` },
        { label: t('admin.providersCount'), value: s.providers },
        { label: t('admin.mcpCount'), value: s.mcpServers },
        { label: t('admin.kbCount'), value: s.knowledgeBases },
    ];
});
</script>

<template>
    <div class="space-y-8">
        <!-- 加载失败提示：否则所有 KPI 显示 0，会被误读为「平台无数据」 -->
        <div v-if="loadError" class="flex items-center justify-between gap-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">
            <span>{{ loadError }}</span>
            <button type="button" class="shrink-0 rounded-lg bg-white px-3 py-1 text-xs font-bold text-red-600 hover:bg-red-100" @click="load">
                {{ t('common.retry') }}
            </button>
        </div>

        <!-- 头部欢迎与快捷入口 -->
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
                <h1 class="text-2xl font-black tracking-tight text-slate-900">{{ t('admin.dashboardTitle') }}</h1>
                <p class="mt-1 text-xs text-slate-500">{{ t('admin.dashboardSubtitle') }}</p>
            </div>
            <div class="flex flex-wrap items-center gap-2.5">
                <NuxtLink
                    to="/admin/agents"
                    class="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs transition-all hover:bg-emerald-700 active:scale-95"
                >
                    + {{ t('agents.createAgent') }}
                </NuxtLink>
                <NuxtLink
                    to="/admin/plans"
                    class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50"
                >
                    {{ t('nav.plans') }}
                </NuxtLink>
                <NuxtLink
                    to="/admin/orders"
                    class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50"
                >
                    {{ t('nav.orders') }}
                </NuxtLink>
            </div>
        </div>

        <!-- 首次加载骨架：接口未回来前不渲染 KPI/明细，避免全 0 被误读为「平台没有数据」 -->
        <div v-if="loading && !stats" class="space-y-4">
            <div class="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <div v-for="n in 4" :key="n" class="app-skeleton h-24 rounded-2xl" />
            </div>
            <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <div v-for="n in 4" :key="n" class="app-skeleton h-14 rounded-xl" />
            </div>
        </div>

        <!-- 核心 KPI：标准 4 列两行，主指标实心卡 + 资产指标浅底条 -->
        <div v-else-if="stats" class="space-y-4">
            <div class="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <div v-for="card in primaryCards" :key="card.label" class="app-card p-5">
                    <p class="text-faint text-xs font-bold">{{ card.label }}</p>
                    <p class="text-strong mt-2 text-2xl font-black tabular-nums">{{ card.value }}</p>
                    <p v-if="card.hint" class="text-faint mt-1 text-[11px]">{{ card.hint }}</p>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <div v-for="card in assetCards" :key="card.label" class="app-panel flex items-center justify-between gap-3 px-4 py-3">
                    <div class="min-w-0">
                        <p class="text-faint truncate text-[11px] font-bold">{{ card.label }}</p>
                        <p v-if="card.hint" class="text-faint mt-0.5 truncate text-[10px]">{{ card.hint }}</p>
                    </div>
                    <p class="text-strong shrink-0 text-lg font-black tabular-nums">{{ card.value }}</p>
                </div>
            </div>
        </div>

        <!-- 详细数据面板：模型使用热度 + 最新动态 -->
        <div v-if="stats" class="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <!-- 模型调用活跃度排行 -->
            <div class="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-2xs">
                <div class="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 class="flex items-center gap-2 text-sm font-black text-slate-900">
                        <span>⚡</span>
                        <span>{{ t('admin.modelUsage') }}</span>
                    </h3>
                    <NuxtLink to="/admin/providers" class="text-xs font-bold text-emerald-600 hover:underline"> {{ t('nav.providers') }} › </NuxtLink>
                </div>

                <div v-if="stats?.modelUsage?.length" class="space-y-3.5">
                    <div v-for="item in stats.modelUsage" :key="item.model" class="space-y-1.5">
                        <div class="flex items-center justify-between text-xs">
                            <span class="max-w-[70%] truncate font-mono font-semibold text-slate-800">{{ item.model }}</span>
                            <span class="text-[11px] text-slate-400">{{ item.conversations }}</span>
                        </div>
                        <div class="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                                class="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-500"
                                :style="{ width: Math.max(8, Math.round((item.conversations / maxModelCount) * 100)) + '%' }"
                            />
                        </div>
                    </div>
                </div>
                <p v-else class="py-12 text-center text-xs text-slate-400">{{ t('admin.tableEmpty') }}</p>
            </div>

            <!-- 最新活跃会话 -->
            <div class="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-2xs">
                <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 class="flex items-center gap-2 text-sm font-black text-slate-900">
                        <span>💬</span>
                        <span>{{ t('admin.recentConversations') }}</span>
                    </h3>
                    <NuxtLink to="/admin/conversations" class="text-xs font-bold text-emerald-600 hover:underline"> {{ t('common.all') }} › </NuxtLink>
                </div>

                <div v-if="stats?.recentConversations?.length" class="divide-y divide-slate-100">
                    <div v-for="conv in stats.recentConversations" :key="conv.id" class="flex items-center justify-between py-3 text-xs">
                        <div class="flex min-w-0 items-center gap-2.5 pr-2">
                            <span class="text-base">{{ conv.agentEmoji || '🤖' }}</span>
                            <div class="min-w-0">
                                <p class="truncate font-bold text-slate-800">{{ conv.title }}</p>
                                <p class="truncate text-[10px] text-slate-400">{{ conv.agentName }}</p>
                            </div>
                        </div>
                        <span class="text-[10px] whitespace-nowrap text-slate-400">
                            {{ new Date(conv.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
                        </span>
                    </div>
                </div>
                <p v-else class="py-12 text-center text-xs text-slate-400">{{ t('admin.tableEmpty') }}</p>
            </div>

            <!-- 最新入驻用户 -->
            <div class="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-2xs">
                <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 class="flex items-center gap-2 text-sm font-black text-slate-900">
                        <span>👥</span>
                        <span>{{ t('admin.recentUsers') }}</span>
                    </h3>
                    <NuxtLink to="/admin/users" class="text-xs font-bold text-emerald-600 hover:underline"> {{ t('nav.users') }} › </NuxtLink>
                </div>

                <div v-if="stats?.recentUsers?.length" class="divide-y divide-slate-100">
                    <div v-for="u in stats.recentUsers" :key="u.id" class="flex items-center justify-between py-3 text-xs">
                        <div class="flex min-w-0 items-center gap-2.5 pr-2">
                            <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-black text-slate-700">
                                {{ u.name?.[0]?.toUpperCase() || 'U' }}
                            </div>
                            <div class="min-w-0">
                                <p class="truncate font-bold text-slate-800">{{ u.name }}</p>
                                <p class="truncate text-[10px] text-slate-400">{{ u.email }}</p>
                            </div>
                        </div>
                        <span
                            class="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                            :class="u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'"
                        >
                            {{ u.role === 'admin' ? 'Admin' : 'User' }}
                        </span>
                    </div>
                </div>
                <p v-else class="py-12 text-center text-xs text-slate-400">{{ t('admin.tableEmpty') }}</p>
            </div>
        </div>
    </div>
</template>
