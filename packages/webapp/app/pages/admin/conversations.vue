<script setup lang="ts">
import { extractApiError, formatDate } from '@commons/contract';
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
type ConversationDetail = { conversation: ConversationRow; messages: MessageRow[] };

const conversations = ref<ConversationRow[]>([]);
/** 库内可展示会话总数与本页截断上限：列表只带最近 limit 条，chip 不能再拿本页长度当「共 N」 */
const serverTotal = ref(0);
const serverLimit = ref(200);
const detail = ref<ConversationDetail | null>(null);
/** 详情面板的单飞序号：只有最后一次点击的响应可以写入 detail */
let detailToken = 0;
const searchKeyword = ref('');
const loading = ref(true); // 首帧即加载态：数据要等挂载后的请求，初值 false 会让「暂无…」空态先闪一帧，SSR 首屏更是直接把空态发给用户
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
        const res = await $fetch<{ conversations: ConversationRow[]; total: number; limit: number }>('/api/admin/conversations');
        conversations.value = res.conversations;
        serverTotal.value = res.total;
        serverLimit.value = res.limit;
    } catch (e) {
        // 失败时清空列表并给出提示，避免把「加载失败」显示成「没有会话」
        conversations.value = [];
        serverTotal.value = 0;
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

async function open(row: ConversationRow) {
    error.value = '';
    const token = ++detailToken;
    // 先收起上一份详情：慢响应或失败时，右侧面板不会把「上一个会话的内容」当作刚点开的这个来读
    detail.value = null;
    try {
        const res = await $fetch<ConversationDetail>(`/api/admin/conversations/${encodeURIComponent(row.id)}`);
        if (token !== detailToken) return;
        detail.value = res;
    } catch (e) {
        if (token !== detailToken) return;
        error.value = extractApiError(e, t('common.loadFailed'));
    }
}

/** 关闭详情：同时作废在途请求，否则「点开→立刻关掉」会让响应回来时面板自己复活 */
function closeDetail() {
    detailToken += 1;
    detail.value = null;
}

async function remove(id: string) {
    if (!confirm(t('chat.deleteConfirm'))) return;
    error.value = '';
    try {
        await $fetch(`/api/admin/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
        closeDetail();
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
                <p class="app-page-subtitle">{{ t('adminForm.convSubtitle') }}</p>
            </div>
            <div class="app-page-actions">
                <span class="app-chip">{{
                    searchKeyword.trim()
                        ? t('adminForm.convFilteredChip', { n: filteredConversations.length })
                        : t('adminForm.convTotalChip', { n: serverTotal })
                }}</span>
                <span v-if="!searchKeyword.trim() && serverTotal > conversations.length" class="app-chip">{{
                    t('adminForm.convTruncatedChip', { limit: serverLimit })
                }}</span>
                <button type="button" class="app-btn app-btn-outline app-btn-sm" @click="load">🔄 {{ t('common.refresh') }}</button>
            </div>
        </div>

        <!-- 检索工具条 -->
        <div class="app-card p-3">
            <div class="relative w-full">
                <input
                    v-model="searchKeyword"
                    :placeholder="t('admin.searchConversations')"
                    :aria-label="t('admin.searchConversations')"
                    class="app-input !py-2 !pr-8 !text-xs"
                />
                <button
                    v-if="searchKeyword"
                    type="button"
                    class="text-faint absolute top-1/2 right-3 -translate-y-1/2 text-xs hover:opacity-70"
                    :aria-label="t('common.clear')"
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
                                    <p class="text-faint mt-0.5 text-[11px]">{{ c.agentName }} · {{ formatDate(c.updatedAt) }}</p>
                                </td>
                                <td>
                                    <p class="text-soft font-semibold">{{ c.userName }}</p>
                                    <p class="text-faint max-w-[150px] truncate text-[10px]">{{ c.userEmail }}</p>
                                </td>
                                <td>
                                    <div class="app-table-actions">
                                        <button class="app-btn app-btn-soft app-btn-sm" @click="open(c)">{{ t('adminForm.view') }}</button>
                                        <button class="app-btn app-btn-danger app-btn-sm" @click="remove(c.id)">{{ t('common.delete') }}</button>
                                    </div>
                                </td>
                            </tr>
                            <tr v-if="!filteredConversations.length && !loading">
                                <td colspan="3" class="!whitespace-normal">
                                    <div class="app-empty">
                                        <span class="app-empty-icon">💬</span>
                                        <p class="app-empty-title">{{ t('admin.noData') }}</p>
                                        <p class="app-empty-desc">{{ t('adminForm.convEmptyFiltered') }}</p>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    <div v-if="loading" class="space-y-2 p-4">
                        <div v-for="i in 4" :key="i" class="app-skeleton h-10 !rounded-xl" />
                    </div>
                </div>
            </div>

            <!-- 会话详情面板 -->
            <div class="w-full lg:w-1/2">
                <!-- sticky 只在 lg 双栏时有意义；窄屏单列下吸顶会盖住列表内容 -->
                <div v-if="detail" class="app-card space-y-4 p-6 lg:sticky lg:top-20">
                    <div class="border-line flex items-center justify-between border-b pb-3">
                        <div class="min-w-0">
                            <h2 class="text-strong max-w-full truncate text-base font-black">{{ detail.conversation.title }}</h2>
                            <p class="text-faint mt-0.5 truncate text-xs">{{ detail.conversation.agentName }} · {{ detail.conversation.userEmail }}</p>
                        </div>
                        <button class="text-faint shrink-0 p-1.5 hover:opacity-70" :aria-label="t('common.close')" @click="closeDetail">✕</button>
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
                            <p class="text-strong leading-relaxed whitespace-pre-wrap">{{ textOf(m.parts) || t('adminForm.convNoPlainText') }}</p>
                        </div>
                    </div>
                </div>
                <div v-else class="app-card app-empty">
                    <span class="app-empty-icon">🔍</span>
                    <p class="app-empty-desc">{{ t('adminForm.convDetailHint') }}</p>
                </div>
            </div>
        </div>
    </div>
</template>
