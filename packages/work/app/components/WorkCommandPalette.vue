<script setup lang="ts">
import { useI18n } from 'vue-i18n';

interface ConversationHit {
    id: string;
    title: string;
    agentId: string;
    agentName: string;
    spaceName: string | null;
}
interface MessageHit {
    id: string;
    conversationId: string;
    conversationTitle: string;
    agentId: string;
    agentName: string;
    spaceName: string | null;
    snippet: string;
}
interface ScheduleHit {
    id: string;
    title: string;
    prompt: string;
    agentName: string | null;
    spaceName: string | null;
}
interface SpaceHit {
    id: string;
    name: string;
    description: string;
    icon: string;
}
interface AttachmentHit {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
}
interface KnowledgeHit {
    id: string;
    name: string;
    description: string;
}
interface KbDocHit {
    id: string;
    kbId: string;
    kbName: string;
    title: string;
}
interface SearchResponse {
    conversations: ConversationHit[];
    messages: MessageHit[];
    schedules: ScheduleHit[];
    spaces: SpaceHit[];
    attachments: AttachmentHit[];
    knowledgeBases: KnowledgeHit[];
    kbDocuments: KbDocHit[];
}

interface PaletteItem {
    key: string;
    group: string;
    label: string;
    description?: string;
    icon: string;
    to: string;
}

const { t } = useI18n();
const { open, query, hide } = useCommandPalette();
const panelRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const results = ref<SearchResponse | null>(null);
const loading = ref(false);
const activeIndex = ref(0);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let requestToken = 0;

useDrawerFocus(() => open.value, panelRef, hide);

const searchItems = computed<PaletteItem[]>(() => {
    const data = results.value;
    if (!data) return [];
    return [
        ...data.conversations.map((hit) => ({
            key: `conversation-${hit.id}`,
            group: t('commandPalette.conversations'),
            label: hit.title,
            description: [hit.spaceName, hit.agentName].filter(Boolean).join(' · '),
            icon: 'chat-outline',
            to: `/chat/${encodeURIComponent(hit.agentId)}?c=${encodeURIComponent(hit.id)}`,
        })),
        ...data.messages.map((hit) => ({
            key: `message-${hit.id}`,
            group: t('commandPalette.messages'),
            label: hit.snippet || hit.conversationTitle,
            description: [hit.conversationTitle, hit.spaceName, hit.agentName].filter(Boolean).join(' · '),
            icon: 'magnify',
            to: `/chat/${encodeURIComponent(hit.agentId)}?c=${encodeURIComponent(hit.conversationId)}`,
        })),
        ...data.schedules.map((hit) => ({
            key: `schedule-${hit.id}`,
            group: t('commandPalette.automations'),
            label: hit.title,
            description: [hit.spaceName, hit.agentName, hit.prompt].filter(Boolean).join(' · '),
            icon: 'timer-outline',
            to: `/tasks?id=${encodeURIComponent(hit.id)}`,
        })),
        ...data.spaces.map((hit) => ({
            key: `space-${hit.id}`,
            group: t('commandPalette.spaces'),
            label: `${hit.icon} ${hit.name}`,
            description: hit.description,
            icon: 'folder-outline',
            to: `/spaces/${encodeURIComponent(hit.id)}`,
        })),
        ...data.attachments.map((hit) => ({
            key: `attachment-${hit.id}`,
            group: t('commandPalette.attachments'),
            label: hit.filename,
            description: hit.mimeType,
            icon: hit.mimeType.startsWith('image/') ? 'file-image-outline' : 'file-outline',
            to: '/library',
        })),
        ...data.knowledgeBases.map((hit) => ({
            key: `kb-${hit.id}`,
            group: t('commandPalette.knowledge'),
            label: hit.name,
            description: hit.description,
            icon: 'book-open-page-variant-outline',
            to: '/settings/knowledge',
        })),
        ...data.kbDocuments.map((hit) => ({
            key: `kbdoc-${hit.id}`,
            group: t('commandPalette.knowledgeDocs'),
            label: hit.title,
            description: hit.kbName,
            icon: 'file-outline',
            to: '/settings/knowledge',
        })),
    ];
});

const items = computed(() => searchItems.value);
const groupedItems = computed(() => {
    const groups = new Map<string, PaletteItem[]>();
    for (const item of items.value) {
        const list = groups.get(item.group) ?? [];
        list.push(item);
        groups.set(item.group, list);
    }
    return [...groups.entries()].map(([group, list]) => ({ group, list }));
});

watch(open, async (value) => {
    if (!value) {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = null;
        results.value = null;
        loading.value = false;
        query.value = '';
        return;
    }
    activeIndex.value = 0;
    await nextTick();
    inputRef.value?.focus();
});

watch(query, (value) => {
    activeIndex.value = 0;
    if (searchTimer) clearTimeout(searchTimer);
    const q = value.trim();
    if (!q) {
        results.value = null;
        loading.value = false;
        return;
    }
    loading.value = true;
    searchTimer = setTimeout(async () => {
        const token = ++requestToken;
        try {
            const data = await $fetch<SearchResponse>('/api/search', { query: { q } });
            if (token === requestToken) results.value = data;
        } catch {
            if (token === requestToken) results.value = null;
        } finally {
            if (token === requestToken) loading.value = false;
        }
    }, 180);
});

function selectItem(item: PaletteItem | undefined) {
    if (!item) return;
    hide();
    void navigateTo(item.to);
}

function onInputKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (!items.value.length) return;
        activeIndex.value = (activeIndex.value + 1) % items.value.length;
        return;
    }
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (!items.value.length) return;
        activeIndex.value = (activeIndex.value - 1 + items.value.length) % items.value.length;
        return;
    }
    if (event.key === 'Enter') {
        event.preventDefault();
        selectItem(items.value[activeIndex.value]);
    }
}

function globalKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        open.value = !open.value;
    }
}

onMounted(() => document.addEventListener('keydown', globalKeydown));
onBeforeUnmount(() => {
    document.removeEventListener('keydown', globalKeydown);
    if (searchTimer) clearTimeout(searchTimer);
});
</script>

<template>
    <Teleport to="body">
        <div v-if="open" ref="panelRef" class="app-modal-backdrop" role="dialog" aria-modal="true" :aria-label="t('commandPalette.title')" @click.self="hide">
            <div class="app-card flex max-h-[min(42rem,85vh)] w-full max-w-2xl flex-col overflow-hidden !p-0">
                <div class="border-line flex items-center gap-2 border-b px-4 py-3">
                    <AppIcon name="magnify" :size="18" class="text-faint shrink-0" />
                    <input
                        ref="inputRef"
                        v-model="query"
                        class="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none"
                        :placeholder="t('commandPalette.placeholder')"
                        :aria-label="t('commandPalette.placeholder')"
                        @keydown="onInputKeydown"
                    />
                    <span v-if="loading" class="text-faint text-[10px]">{{ t('common.loading') }}</span>
                    <button type="button" class="text-faint text-hover-strong rounded px-1.5 py-0.5 text-[10px]" @click="hide">Esc</button>
                </div>

                <div class="min-h-0 flex-1 overflow-y-auto p-2">
                    <div v-if="groupedItems.length" class="space-y-3">
                        <section v-for="group in groupedItems" :key="group.group">
                            <p class="text-faint px-2 pb-1 text-[10px] font-bold tracking-wide uppercase">{{ group.group }}</p>
                            <button
                                v-for="item in group.list"
                                :key="item.key"
                                type="button"
                                class="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors"
                                :class="items[activeIndex]?.key === item.key ? 'bg-[color:var(--surface-3)]' : 'hover:bg-[color:var(--surface-3)]'"
                                @mouseenter="activeIndex = items.findIndex((candidate) => candidate.key === item.key)"
                                @click="selectItem(item)"
                            >
                                <span class="app-avatar-icon h-8 w-8 shrink-0 text-sm">
                                    <AppIcon :name="item.icon" :size="15" />
                                </span>
                                <span class="min-w-0 flex-1">
                                    <span class="text-strong block truncate text-xs font-bold">{{ item.label }}</span>
                                    <span v-if="item.description" class="text-faint mt-0.5 block truncate text-[10px]">{{ item.description }}</span>
                                </span>
                                <AppIcon name="chevron-right" :size="14" class="text-faint shrink-0" />
                            </button>
                        </section>
                    </div>
                    <div v-else-if="query.trim() && !loading" class="app-empty py-12">
                        <AppIcon name="magnify" :size="28" class="app-empty-icon" />
                        <p class="app-empty-title">{{ t('commandPalette.noResults') }}</p>
                        <p class="app-empty-desc">{{ t('commandPalette.noResultsHint') }}</p>
                    </div>
                    <div v-else class="app-empty py-12">
                        <AppIcon name="magnify" :size="28" class="app-empty-icon" />
                        <p class="app-empty-title">{{ t('commandPalette.emptyTitle') }}</p>
                        <p class="app-empty-desc">{{ t('commandPalette.emptyHint') }}</p>
                    </div>
                </div>

                <div class="border-line text-faint flex items-center gap-3 border-t px-4 py-2 text-[10px]">
                    <span>↑↓ {{ t('commandPalette.navigate') }}</span>
                    <span>Enter {{ t('commandPalette.open') }}</span>
                    <span>Esc {{ t('common.close') }}</span>
                    <span class="ml-auto">Ctrl / ⌘ + K</span>
                </div>
            </div>
        </div>
    </Teleport>
</template>
