<script setup lang="ts">
import type { AgentSummary, ConversationSummary } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ middleware: 'auth' });

const { t } = useI18n();

const agents = ref<AgentSummary[]>([]);
const conversations = ref<ConversationSummary[]>([]);
const searchKeyword = ref('');
const favorites = ref<string[]>([]);
const loading = ref(true);

onMounted(async () => {
    try {
        favorites.value = JSON.parse(localStorage.getItem('favorite_agents') || '[]');
    } catch {
        favorites.value = [];
    }
    try {
        const [agentRes, convRes] = await Promise.all([$fetch<AgentSummary[]>('/api/agents'), $fetch<ConversationSummary[]>('/api/conversations')]);
        agents.value = agentRes;
        conversations.value = convRes;
    } finally {
        loading.value = false;
    }
});

function toggleFavorite(id: string, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (favorites.value.includes(id)) {
        favorites.value = favorites.value.filter((f) => f !== id);
    } else {
        favorites.value.push(id);
    }
    try {
        localStorage.setItem('favorite_agents', JSON.stringify(favorites.value));
    } catch {
        // ignore
    }
}

const filteredAgents = computed(() => {
    const q = searchKeyword.value.trim().toLowerCase();
    let list = agents.value;
    if (q) {
        list = list.filter(
            (a) => a.name.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q) || a.skills?.some((s) => s.name.toLowerCase().includes(q)),
        );
    }
    // 收藏置顶排序
    return [...list].sort((a, b) => {
        const aFav = favorites.value.includes(a.id) ? 1 : 0;
        const bFav = favorites.value.includes(b.id) ? 1 : 0;
        return bFav - aFav;
    });
});

async function removeConversation(id: string) {
    if (!confirm(t('chat.deleteConfirm'))) return;
    await $fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    conversations.value = conversations.value.filter((c) => c.id !== id);
}
</script>

<template>
    <div class="grid grid-cols-1 gap-7 lg:grid-cols-3">
        <!-- 智能体广场列表 -->
        <section class="space-y-5 lg:col-span-2">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 class="flex items-center gap-2 text-xl font-black">
                        <span>{{ t('agents.title') }}</span>
                        <span class="app-chip app-chip-brand text-[11px] font-bold">
                            {{ filteredAgents.length }}
                        </span>
                    </h1>
                    <p class="text-muted-2 mt-1 text-xs">{{ t('agents.subtitle') }}</p>
                </div>

                <!-- 搜索栏 -->
                <div class="relative w-full sm:w-72">
                    <input v-model="searchKeyword" :placeholder="t('agents.searchPlaceholder')" class="app-input !pl-9 !text-xs" />
                    <span class="text-faint absolute top-2.5 left-3 text-xs">🔍</span>
                    <button
                        v-if="searchKeyword"
                        type="button"
                        class="text-faint hover:text-strong absolute top-2 right-2.5 text-xs"
                        @click="searchKeyword = ''"
                    >
                        ✕
                    </button>
                </div>
            </div>

            <!-- 智能体网格卡片 -->
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <NuxtLink
                    v-for="agent in filteredAgents"
                    :key="agent.id"
                    :to="`/chat/${agent.id}`"
                    class="app-card app-card-hover group relative flex flex-col justify-between p-5"
                >
                    <!-- 收藏置顶按钮 -->
                    <button
                        type="button"
                        class="absolute top-4 right-4 rounded-full p-1 text-base transition-transform active:scale-90"
                        :class="favorites.includes(agent.id) ? 'text-[color:var(--warning)]' : 'text-faint hover:text-muted-2'"
                        :title="favorites.includes(agent.id) ? t('common.cancel') : t('agents.topPin')"
                        @click="(e) => toggleFavorite(agent.id, e)"
                    >
                        ★
                    </button>

                    <div>
                        <div class="flex items-center gap-3 pr-8">
                            <div class="app-avatar-icon h-11 w-11 shrink-0 text-2xl transition-transform group-hover:scale-105">
                                {{ agent.emoji || agent.avatar || '🤖' }}
                            </div>
                            <div class="min-w-0 flex-1">
                                <p class="group-hover:text-brand truncate text-sm font-bold transition-colors">
                                    {{ agent.name }}
                                </p>
                                <span v-if="favorites.includes(agent.id)" class="inline-block text-[10px] font-semibold text-[color:var(--warning)]">
                                    ⭐ {{ t('agents.topPin') }}
                                </span>
                            </div>
                        </div>

                        <p class="text-muted-2 mt-3 line-clamp-2 text-xs leading-relaxed">{{ agent.description || t('common.none') }}</p>
                    </div>

                    <div v-if="agent.skills?.length" class="app-divider mt-4 flex flex-wrap gap-1.5 pt-2">
                        <span v-for="s in agent.skills" :key="s.id" class="app-chip text-[10px]">
                            {{ s.name }}
                        </span>
                    </div>
                </NuxtLink>

                <!-- 空状态 -->
                <div v-if="!filteredAgents.length && !loading" class="app-card text-faint col-span-2 p-12 text-center text-xs">
                    <p class="mb-2 text-3xl">🔍</p>
                    <p>{{ t('agents.noAgents') }}</p>
                </div>
            </div>
        </section>

        <!-- 最近会话历史列表 -->
        <aside class="space-y-5">
            <h2 class="flex items-center justify-between text-xl font-black">
                <span>{{ t('nav.conversations') }}</span>
                <span class="text-faint text-xs font-normal">({{ conversations.length }})</span>
            </h2>

            <ul class="space-y-2.5">
                <li v-for="c in conversations" :key="c.id" class="app-card app-card-hover group flex items-center justify-between p-3.5 text-xs">
                    <NuxtLink :to="`/chat/${c.agentId}?c=${c.id}`" class="min-w-0 flex-1 pr-2">
                        <p class="group-hover:text-brand truncate font-semibold transition-colors">{{ c.title }}</p>
                        <p class="text-faint mt-1 flex items-center gap-1.5 text-[10px]">
                            <span>{{ c.agentName }}</span>
                            <span>·</span>
                            <span>{{ new Date(c.updatedAt).toLocaleDateString() }}</span>
                        </p>
                    </NuxtLink>
                    <button
                        type="button"
                        class="text-faint hidden p-1 transition-colors group-hover:block hover:text-[color:var(--danger)]"
                        :title="t('chat.deleteChat')"
                        @click="removeConversation(c.id)"
                    >
                        ✕
                    </button>
                </li>
                <li v-if="!conversations.length" class="app-card text-faint p-8 text-center text-xs" style="border-style: dashed">
                    {{ t('chat.noMessages') }}
                </li>
            </ul>
        </aside>
    </div>
</template>
