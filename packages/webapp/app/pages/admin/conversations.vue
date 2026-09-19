<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

const { t } = useI18n();

interface ConversationRow {
    id: string;
    title: string;
    userId: string;
    userName: string;
    userEmail: string;
    agentName: string;
    updatedAt: string;
}
interface MessageRow {
    id: string;
    role: string;
    parts: { type: string; text?: string }[];
}

const conversations = ref<ConversationRow[]>([]);
const detail = ref<{ conversation: ConversationRow; messages: MessageRow[] } | null>(null);
const searchKeyword = ref('');
const loading = ref(false);
const error = ref('');

const filteredConversations = computed(() => {
    const q = searchKeyword.value.trim().toLowerCase();
    if (!q) return conversations.value;
    return conversations.value.filter(
        (c) =>
            c.title.toLowerCase().includes(q) ||
            c.agentName.toLowerCase().includes(q) ||
            c.userName.toLowerCase().includes(q) ||
            c.userEmail.toLowerCase().includes(q),
    );
});

async function load() {
    loading.value = true;
    error.value = '';
    try {
        conversations.value = await $fetch<ConversationRow[]>('/api/admin/conversations');
    } catch (e) {
        // 失败时清空列表并给出提示，避免把「加载失败」显示成「没有会话」
        conversations.value = [];
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

async function open(row: ConversationRow) {
    error.value = '';
    try {
        detail.value = await $fetch(`/api/admin/conversations/${row.id}`);
    } catch (e) {
        error.value = extractApiError(e, t('common.loadFailed'));
    }
}

async function remove(id: string) {
    if (!confirm(t('chat.deleteConfirm'))) return;
    error.value = '';
    try {
        await $fetch(`/api/admin/conversations/${id}`, { method: 'DELETE' });
        detail.value = null;
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

function textOf(parts: MessageRow['parts']) {
    return (parts ?? [])
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('');
}
</script>

<template>
    <div class="space-y-6">
        <div class="app-page-header !mb-0">
            <div>
                <h1 class="app-page-title text-strong">{{ t('nav.conversations') }}</h1>
                <p class="app-page-subtitle">全平台会话质检与安全审计，快速检索对话内容与智能体响应</p>
            </div>
            <div class="app-page-actions">
                <span class="app-chip">{{ t('common.total') }} {{ filteredConversations.length }} 会话</span>
                <button type="button" class="app-btn app-btn-outline app-btn-sm" @click="load">🔄 {{ t('common.refresh') }}</button>
            </div>
        </div>

        <!-- 检索工具条 -->
        <div class="app-card p-3">
            <div class="relative w-full">
                <input v-model="searchKeyword" :placeholder="t('admin.searchConversations')" class="app-input !py-2 pr-8 !text-xs" />
                <button
                    v-if="searchKeyword"
                    type="button"
                    class="text-faint absolute top-1/2 right-3 -translate-y-1/2 text-xs hover:opacity-70"
                    @click="searchKeyword = ''"
                >
                    ✕
                </button>
            </div>
        </div>

        <div v-if="error" class="app-alert app-alert-danger">
            {{ error }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>

        <div class="flex flex-col gap-6 lg:flex-row">
            <!-- 会话列表 -->
            <div class="w-full lg:w-1/2">
                <div class="app-table-wrap">
                    <table class="app-table">
                        <thead>
                            <tr>
                                <th>{{ t('nav.chat') }}</th>
                                <th>{{ t('nav.users') }}</th>
                                <th class="text-right">{{ t('common.actions') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="c in filteredConversations" :key="c.id" :class="detail?.conversation?.id === c.id ? 'bg-brand-soft' : ''">
                                <td>
                                    <p class="text-strong max-w-[200px] truncate font-bold">{{ c.title }}</p>
                                    <p class="text-faint mt-0.5 text-[11px]">{{ c.agentName }} · {{ new Date(c.updatedAt).toLocaleDateString() }}</p>
                                </td>
                                <td>
                                    <p class="text-soft font-semibold">{{ c.userName }}</p>
                                    <p class="text-faint max-w-[150px] truncate text-[10px]">{{ c.userEmail }}</p>
                                </td>
                                <td>
                                    <div class="app-table-actions">
                                        <button class="app-btn app-btn-soft app-btn-sm" @click="open(c)">查看</button>
                                        <button class="app-btn app-btn-danger app-btn-sm" @click="remove(c.id)">{{ t('common.delete') }}</button>
                                    </div>
                                </td>
                            </tr>
                            <tr v-if="!filteredConversations.length && !loading">
                                <td colspan="3" class="!whitespace-normal">
                                    <div class="app-empty">
                                        <span class="app-empty-icon">💬</span>
                                        <p class="app-empty-title">{{ t('admin.noData') }}</p>
                                        <p class="app-empty-desc">没有找到匹配的会话历史记录</p>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    <div v-if="loading" class="space-y-2 p-4">
                        <div v-for="i in 4" :key="i" class="app-skeleton h-10 rounded-xl" />
                    </div>
                </div>
            </div>

            <!-- 会话详情面板 -->
            <div class="w-full lg:w-1/2">
                <div v-if="detail" class="app-card sticky top-20 space-y-4 p-6">
                    <div class="border-line flex items-center justify-between border-b pb-3">
                        <div class="min-w-0">
                            <h2 class="text-strong max-w-full truncate text-base font-black">{{ detail.conversation.title }}</h2>
                            <p class="text-faint mt-0.5 truncate text-xs">{{ detail.conversation.agentName }} · {{ detail.conversation.userEmail }}</p>
                        </div>
                        <button class="text-faint shrink-0 hover:opacity-70" @click="detail = null">✕</button>
                    </div>

                    <div class="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                        <div
                            v-for="m in detail.messages"
                            :key="m.id"
                            :class="[
                                'rounded-2xl border p-3.5 text-xs',
                                m.role === 'user' ? 'border-brand-soft bg-brand-soft ml-8' : 'border-line bg-surface-2 mr-8',
                            ]"
                        >
                            <p class="mb-1 text-[10px] font-bold tracking-wider uppercase" :class="m.role === 'user' ? 'text-brand' : 'text-muted-2'">
                                {{ m.role === 'user' ? '👤 User' : '🤖 Assistant' }}
                            </p>
                            <p class="text-strong leading-relaxed whitespace-pre-wrap">{{ textOf(m.parts) || '（无纯文本内容）' }}</p>
                        </div>
                    </div>
                </div>
                <div v-else class="app-card app-empty">
                    <span class="app-empty-icon">🔍</span>
                    <p class="app-empty-desc">点击左侧会话「查看」按钮以回溯对话详情</p>
                </div>
            </div>
        </div>
    </div>
</template>
