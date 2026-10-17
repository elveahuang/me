<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import type { KnowledgeBaseItem } from '../../utils/knowledge';

definePageMeta({ layout: 'settings' });

/** 知识库列表：只负责发现、筛选和创建；文档与索引操作进入详情页。 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { spaces } = useChatSidebar();

const kbs = ref<KnowledgeBaseItem[]>([]);
const loading = ref(true);
const listError = ref('');
const keyword = ref('');
const spaceFilter = ref(typeof route.query.spaceId === 'string' ? route.query.spaceId : '');

watch(
    () => route.query.spaceId,
    (value) => {
        const next = typeof value === 'string' ? value : '';
        if (spaceFilter.value !== next) spaceFilter.value = next;
    },
);

watch(spaceFilter, (value) => {
    const query = { ...route.query };
    if (value) query.spaceId = value;
    else delete query.spaceId;
    void router.replace({ query });
});

const createOpen = ref(false);
const creating = ref(false);
const createError = ref('');
const form = reactive({ name: '', description: '', spaceId: '', embeddingModel: 'text-embedding-3-small' });
watch(form, () => (createError.value = ''), { deep: true });

const filtered = computed(() => {
    const q = keyword.value.trim().toLowerCase();
    return kbs.value.filter((kb) => {
        if (spaceFilter.value === '__global__' && kb.spaceId !== null) return false;
        if (spaceFilter.value && spaceFilter.value !== '__global__' && kb.spaceId !== spaceFilter.value) return false;
        if (!q) return true;
        return kb.name.toLowerCase().includes(q) || kb.description.toLowerCase().includes(q);
    });
});

async function load() {
    loading.value = true;
    listError.value = '';
    try {
        kbs.value = await $fetch<KnowledgeBaseItem[]>('/api/settings/knowledge-bases');
    } catch (e) {
        kbs.value = [];
        listError.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

function openCreate() {
    Object.assign(form, { name: '', description: '', spaceId: '', embeddingModel: 'text-embedding-3-small' });
    createError.value = '';
    createOpen.value = true;
}

async function createKb() {
    if (creating.value) return;
    if (!form.name.trim()) {
        createError.value = t('adminForm.requiredName');
        return;
    }
    creating.value = true;
    createError.value = '';
    try {
        const created = await $fetch<KnowledgeBaseItem>('/api/settings/knowledge-bases', {
            method: 'POST',
            body: {
                name: form.name.trim(),
                description: form.description.trim(),
                embeddingModel: form.embeddingModel.trim() || 'text-embedding-3-small',
                spaceId: form.spaceId || undefined,
            },
        });
        createOpen.value = false;
        await router.push(`/settings/knowledge/${encodeURIComponent(created.id)}`);
    } catch (e) {
        createError.value = extractApiError(e, t('adminForm.saveFailed'));
    } finally {
        creating.value = false;
    }
}
</script>

<template>
    <div class="space-y-5">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ t('settings.navKnowledge') }}</h1>
                <p class="app-page-subtitle">{{ t('adminForm.kbSubtitle') }}</p>
            </div>
            <div class="flex items-center gap-2">
                <span class="app-chip !text-[10px]">{{ filtered.length }} / {{ kbs.length }}</span>
                <button type="button" class="app-btn app-btn-primary !px-3 !py-1.5 !text-xs" @click="openCreate">
                    <AppIcon name="plus" :size="14" />
                    <span>{{ t('adminForm.kbCreate') }}</span>
                </button>
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <div class="relative min-w-0 flex-1 sm:max-w-sm">
                <AppIcon name="magnify" :size="15" class="text-faint pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
                <input
                    v-model="keyword"
                    class="app-input !pl-8 !text-xs"
                    :placeholder="t('knowledge.searchPlaceholder')"
                    :aria-label="t('knowledge.searchPlaceholder')"
                />
            </div>
            <select v-model="spaceFilter" class="app-input !w-auto !text-xs" :aria-label="t('adminForm.kbSpace')">
                <option value="">{{ t('knowledge.allSpaces') }}</option>
                <option value="__global__">{{ t('knowledge.global') }}</option>
                <option v-for="space in spaces" :key="space.id" :value="space.id">{{ space.icon }} {{ space.name }}</option>
            </select>
            <button
                v-if="keyword || spaceFilter"
                type="button"
                class="app-btn app-btn-ghost !px-3 !py-1.5 !text-xs"
                @click="
                    keyword = '';
                    spaceFilter = '';
                "
            >
                {{ t('common.clear') }}
            </button>
            <button type="button" class="app-btn app-btn-ghost !px-3 !py-1.5 !text-xs" @click="load">{{ t('common.retry') }}</button>
        </div>

        <div v-if="listError" class="app-alert app-alert-danger flex items-center justify-between gap-3">
            <span>{{ listError }}</span>
            <button type="button" class="app-btn app-btn-soft shrink-0 !py-1.5" @click="load">{{ t('common.retry') }}</button>
        </div>

        <div v-if="loading" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div v-for="i in 6" :key="i" class="app-skeleton app-skeleton-card" />
        </div>

        <div v-else-if="filtered.length" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <NuxtLink
                v-for="kb in filtered"
                :key="kb.id"
                :to="`/settings/knowledge/${encodeURIComponent(kb.id)}`"
                class="app-card app-card-hover flex flex-col gap-3 p-4"
            >
                <div class="flex items-start gap-3">
                    <span class="app-avatar-icon h-11 w-11 shrink-0 text-xl">📚</span>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                            <h2 class="text-strong truncate text-sm font-black">{{ kb.name }}</h2>
                            <span class="app-chip shrink-0 !px-1.5 !py-0 !text-[9px]" :class="kb.spaceName ? 'app-chip-brand' : ''">
                                {{ kb.spaceName || t('knowledge.global') }}
                            </span>
                        </div>
                        <p class="text-faint mt-1 line-clamp-2 text-[11px]">{{ kb.description || t('common.none') }}</p>
                    </div>
                </div>
                <div class="text-faint mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                    <span>{{ t('library.documents', { n: kb.documentCount }) }}</span>
                    <span>{{ t('library.chunks', { n: kb.chunkCount }) }}</span>
                    <span class="font-mono">{{ kb.embeddingModel }}</span>
                </div>
                <span class="text-hover-brand text-[11px] font-bold">{{ t('knowledge.open') }} →</span>
            </NuxtLink>
        </div>

        <div v-else-if="!listError" class="app-empty">
            <AppIcon name="book-open-page-variant-outline" :size="30" class="app-empty-icon" />
            <p class="app-empty-title">{{ keyword || spaceFilter ? t('knowledge.noResults') : t('adminForm.kbEmpty') }}</p>
            <p class="app-empty-desc">{{ t('knowledge.createHint') }}</p>
        </div>

        <AdminDrawer :open="createOpen" :title="t('adminForm.kbCreate')" width-class="sm:max-w-xl" @close="createOpen = false">
            <div class="space-y-3">
                <input
                    v-model="form.name"
                    class="app-input"
                    maxlength="100"
                    :placeholder="t('adminForm.kbNamePlaceholder')"
                    :aria-label="t('adminForm.kbNamePlaceholder')"
                />
                <input
                    v-model="form.description"
                    class="app-input"
                    maxlength="500"
                    :placeholder="t('adminForm.description')"
                    :aria-label="t('adminForm.description')"
                />
                <select v-model="form.spaceId" class="app-input" :aria-label="t('adminForm.kbSpace')">
                    <option value="">{{ t('adminForm.kbGlobalSpace') }}</option>
                    <option v-for="space in spaces" :key="space.id" :value="space.id">{{ space.icon }} {{ space.name }}</option>
                </select>
                <input
                    v-model="form.embeddingModel"
                    class="app-input !font-mono !text-xs"
                    :placeholder="t('adminForm.kbEmbeddingModel')"
                    :aria-label="t('adminForm.kbEmbeddingModel')"
                />
                <p v-if="createError" class="app-help-error">{{ createError }}</p>
            </div>
            <template #footer>
                <div class="flex w-full items-center justify-end gap-2">
                    <button type="button" class="app-btn app-btn-ghost" :disabled="creating" @click="createOpen = false">{{ t('adminForm.cancel') }}</button>
                    <button type="button" class="app-btn app-btn-primary" :disabled="creating" @click="createKb">{{ t('adminForm.save') }}</button>
                </div>
            </template>
        </AdminDrawer>
    </div>
</template>
