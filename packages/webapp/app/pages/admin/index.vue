<script setup lang="ts">
import { extractApiError, formatTime } from '@commons/contract';
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
        <div v-if="loadError" class="app-alert app-alert-danger flex items-center justify-between gap-3">
            <span>{{ loadError }}</span>
            <button type="button" class="app-btn app-btn-outline app-btn-sm shrink-0" @click="load">{{ t('common.retry') }}</button>
        </div>

        <!-- 头部欢迎与快捷入口：仅主操作保留品牌色，其余降权为次级按钮 -->
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
                <h1 class="app-page-title text-strong">{{ t('admin.dashboardTitle') }}</h1>
                <p class="app-page-subtitle mt-1">{{ t('admin.dashboardSubtitle') }}</p>
            </div>
            <div class="app-page-actions !mb-0">
                <NuxtLink to="/admin/agents" class="app-btn app-btn-primary app-btn-sm">＋ {{ t('agents.createAgent') }}</NuxtLink>
                <NuxtLink to="/admin/plans" class="app-btn app-btn-ghost app-btn-sm">💳 {{ t('nav.plans') }}</NuxtLink>
                <NuxtLink to="/admin/orders" class="app-btn app-btn-ghost app-btn-sm">🧾 {{ t('nav.orders') }}</NuxtLink>
            </div>
        </div>

        <!-- 首次加载骨架：接口未回来前不渲染 KPI/明细，避免全 0 被误读为「平台没有数据」 -->
        <div v-if="loading && !stats" class="space-y-4">
            <div class="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <div v-for="n in 4" :key="n" class="app-skeleton h-24 !rounded-2xl" />
            </div>
            <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <div v-for="n in 4" :key="n" class="app-skeleton h-14 !rounded-xl" />
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
            <div class="app-card p-6">
                <div class="app-divider mb-4 flex items-center justify-between pb-3">
                    <h3 class="text-strong flex items-center gap-2 text-sm font-black">
                        <span>⚡</span>
                        <span>{{ t('admin.modelUsage') }}</span>
                    </h3>
                    <NuxtLink to="/admin/providers" class="app-link text-xs"> {{ t('nav.providers') }} › </NuxtLink>
                </div>

                <div v-if="stats?.modelUsage?.length" class="space-y-3.5">
                    <div v-for="item in stats.modelUsage" :key="item.model" class="space-y-1.5">
                        <div class="flex items-center justify-between text-xs">
                            <span class="text-strong max-w-[70%] truncate font-mono font-semibold">{{ item.model }}</span>
                            <span class="text-faint text-[11px] tabular-nums">{{ item.conversations }}</span>
                        </div>
                        <div class="bg-surface-3 h-2 w-full overflow-hidden rounded-full">
                            <div
                                class="bg-brand-gradient h-full rounded-full transition-all duration-500"
                                :style="{ width: Math.max(8, Math.round((item.conversations / maxModelCount) * 100)) + '%' }"
                            />
                        </div>
                    </div>
                </div>
                <!-- 空态保留坐标轴与虚拟柱形，而不是把版面塌成一句话 -->
                <div v-else class="app-divider flex h-[168px] flex-col justify-end gap-2 pt-2">
                    <div class="flex h-full items-end gap-2 opacity-50">
                        <div v-for="n in 7" :key="n" class="bg-surface-3 flex-1 rounded-t" :style="{ height: [30, 52, 24, 64, 40, 20, 46][n - 1] + '%' }" />
                    </div>
                    <p class="text-faint pt-2 text-center text-[11px]">{{ t('admin.waitingForData') }}</p>
                </div>
            </div>

            <!-- 最新活跃会话 -->
            <div class="app-card p-6">
                <div class="app-divider mb-3 flex items-center justify-between pb-3">
                    <h3 class="text-strong flex items-center gap-2 text-sm font-black">
                        <span>💬</span>
                        <span>{{ t('admin.recentConversations') }}</span>
                    </h3>
                    <NuxtLink to="/admin/conversations" class="app-link text-xs"> {{ t('common.all') }} › </NuxtLink>
                </div>

                <div v-if="stats?.recentConversations?.length" class="divide-line divide-y">
                    <div v-for="conv in stats.recentConversations" :key="conv.id" class="flex items-center justify-between py-3 text-xs">
                        <div class="flex min-w-0 items-center gap-2.5 pr-2">
                            <span class="text-base">{{ conv.agentEmoji || '🤖' }}</span>
                            <div class="min-w-0">
                                <p class="text-strong truncate font-bold">{{ conv.title }}</p>
                                <p class="text-faint truncate text-[10px]">{{ conv.agentName }}</p>
                            </div>
                        </div>
                        <span class="text-faint text-[10px] whitespace-nowrap tabular-nums">
                            {{ formatTime(conv.updatedAt) }}
                        </span>
                    </div>
                </div>
                <div v-else class="divide-line space-y-3 divide-y opacity-60">
                    <div v-for="n in 4" :key="n" class="flex items-center gap-2.5 pt-3">
                        <div class="app-skeleton h-6 w-6 shrink-0 !rounded-full" />
                        <div class="min-w-0 flex-1 space-y-1.5">
                            <div class="app-skeleton app-skeleton-text !w-2/3" />
                            <div class="app-skeleton app-skeleton-text !w-1/3" />
                        </div>
                    </div>
                    <p class="text-faint pt-3 text-center text-[11px]">{{ t('admin.waitingForData') }}</p>
                </div>
            </div>

            <!-- 最新入驻用户 -->
            <div class="app-card p-6">
                <div class="app-divider mb-3 flex items-center justify-between pb-3">
                    <h3 class="text-strong flex items-center gap-2 text-sm font-black">
                        <span>👥</span>
                        <span>{{ t('admin.recentUsers') }}</span>
                    </h3>
                    <NuxtLink to="/admin/users" class="app-link text-xs"> {{ t('nav.users') }} › </NuxtLink>
                </div>

                <div v-if="stats?.recentUsers?.length" class="divide-line divide-y">
                    <div v-for="u in stats.recentUsers" :key="u.id" class="flex items-center justify-between py-3 text-xs">
                        <div class="flex min-w-0 items-center gap-2.5 pr-2">
                            <div class="app-avatar-icon h-7 w-7 shrink-0 text-[11px] font-black">
                                {{ u.name?.[0]?.toUpperCase() || 'U' }}
                            </div>
                            <div class="min-w-0">
                                <p class="text-strong truncate font-bold">{{ u.name }}</p>
                                <p class="text-faint truncate text-[10px]">{{ u.email }}</p>
                            </div>
                        </div>
                        <span class="app-chip shrink-0">{{ u.role === 'admin' ? 'Admin' : 'User' }}</span>
                    </div>
                </div>
                <div v-else class="divide-line space-y-3 divide-y opacity-60">
                    <div v-for="n in 4" :key="n" class="flex items-center gap-2.5 pt-3">
                        <div class="app-skeleton h-7 w-7 shrink-0 !rounded-full" />
                        <div class="min-w-0 flex-1 space-y-1.5">
                            <div class="app-skeleton app-skeleton-text !w-1/2" />
                            <div class="app-skeleton app-skeleton-text !w-3/4" />
                        </div>
                    </div>
                    <p class="text-faint pt-3 text-center text-[11px]">{{ t('admin.waitingForData') }}</p>
                </div>
            </div>
        </div>
    </div>
</template>
