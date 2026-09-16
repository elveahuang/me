<script setup lang="ts">
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
    conversations.value = await $fetch('/api/admin/conversations');
}

onMounted(load);

async function open(row: ConversationRow) {
    detail.value = await $fetch(`/api/admin/conversations/${row.id}`);
}

async function remove(id: string) {
    if (!confirm(t('chat.deleteConfirm'))) return;
    await $fetch(`/api/admin/conversations/${id}`, { method: 'DELETE' });
    detail.value = null;
    await load();
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
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
                <h1 class="text-2xl font-black tracking-tight text-slate-900">{{ t('nav.conversations') }}</h1>
                <p class="mt-1 text-xs text-slate-500">全平台会话质检与安全审计，快速检索对话内容与智能体响应</p>
            </div>
            <div class="flex items-center gap-2">
                <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                    {{ t('common.total') }} {{ filteredConversations.length }} 会话
                </span>
                <button
                    type="button"
                    class="rounded-xl border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50"
                    @click="load"
                >
                    🔄 {{ t('common.refresh') }}
                </button>
            </div>
        </div>

        <!-- 检索工具条 -->
        <div class="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs">
            <div class="relative w-full">
                <input
                    v-model="searchKeyword"
                    :placeholder="t('admin.searchConversations')"
                    class="focus:border-primary-500 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 transition-colors focus:bg-white focus:outline-none"
                />
                <button
                    v-if="searchKeyword"
                    type="button"
                    class="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
                    @click="searchKeyword = ''"
                >
                    ✕
                </button>
            </div>
        </div>

        <div class="flex flex-col gap-6 lg:flex-row">
            <!-- 会话列表 -->
            <div class="w-full lg:w-1/2">
                <div class="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-2xs">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-50 text-[11px] font-bold text-slate-400 uppercase">
                            <tr>
                                <th class="p-4">{{ t('nav.chat') }}</th>
                                <th class="p-4">{{ t('nav.users') }}</th>
                                <th class="p-4 text-right">{{ t('common.actions') }}</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            <tr
                                v-for="c in filteredConversations"
                                :key="c.id"
                                :class="['transition-colors hover:bg-slate-50/60', detail?.conversation?.id === c.id ? 'bg-primary-50/50' : '']"
                            >
                                <td class="p-4">
                                    <p class="max-w-[200px] truncate text-sm font-bold text-slate-800">{{ c.title }}</p>
                                    <p class="mt-0.5 text-[11px] text-slate-400">{{ c.agentName }} · {{ new Date(c.updatedAt).toLocaleDateString() }}</p>
                                </td>
                                <td class="p-4">
                                    <p class="font-semibold text-slate-700">{{ c.userName }}</p>
                                    <p class="max-w-[150px] truncate text-[10px] text-slate-400">{{ c.userEmail }}</p>
                                </td>
                                <td class="space-x-2 p-4 text-right whitespace-nowrap">
                                    <button class="text-primary-600 hover:text-primary-700 font-bold" @click="open(c)">查看</button>
                                    <button class="font-medium text-rose-500 hover:text-rose-700" @click="remove(c.id)">{{ t('common.delete') }}</button>
                                </td>
                            </tr>
                            <tr v-if="!filteredConversations.length">
                                <td colspan="3" class="p-10 text-center">
                                    <div class="flex flex-col items-center">
                                        <span class="mb-1.5 text-3xl">💬</span>
                                        <p class="text-sm font-bold text-slate-700">{{ t('admin.noData') }}</p>
                                        <p class="mt-0.5 text-xs text-slate-400">没有找到匹配的会话历史记录</p>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- 会话详情面板 -->
            <div class="w-full lg:w-1/2">
                <div v-if="detail" class="sticky top-20 space-y-4 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-2xs">
                    <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div>
                            <h2 class="text-base font-black text-slate-900">{{ detail.conversation.title }}</h2>
                            <p class="mt-0.5 text-xs text-slate-400">{{ detail.conversation.agentName }} · {{ detail.conversation.userEmail }}</p>
                        </div>
                        <button class="text-slate-400 hover:text-slate-600" @click="detail = null">✕</button>
                    </div>

                    <div class="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                        <div
                            v-for="m in detail.messages"
                            :key="m.id"
                            :class="[
                                'rounded-2xl p-3.5 text-xs',
                                m.role === 'user'
                                    ? 'ml-8 border border-emerald-100 bg-emerald-50 text-emerald-950'
                                    : 'mr-8 border border-slate-100 bg-slate-50 text-slate-800',
                            ]"
                        >
                            <p class="mb-1 text-[10px] font-bold tracking-wider uppercase" :class="m.role === 'user' ? 'text-emerald-700' : 'text-slate-500'">
                                {{ m.role === 'user' ? '👤 User' : '🤖 Assistant' }}
                            </p>
                            <p class="leading-relaxed whitespace-pre-wrap">{{ textOf(m.parts) || '（无纯文本内容）' }}</p>
                        </div>
                    </div>
                </div>
                <div v-else class="rounded-3xl border border-dashed border-slate-200 bg-slate-50/50 p-12 text-center text-xs text-slate-400">
                    点击左侧会话「查看」按钮以回溯对话详情
                </div>
            </div>
        </div>
    </div>
</template>
