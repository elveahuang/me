<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import type { WorkSpace } from '../utils/work';

/**
 * 工作空间：会话、资料与自动化的长期上下文。
 *
 * 空间是容器：点「进入空间」打开 /spaces/:id 的空间主页，
 * 在主页里再选择「在空间中新建对话」。侧栏的最近对话始终是全局列表。
 */
const { t } = useI18n();
const { refreshSpaces } = useChatSidebar();

const spaces = ref<WorkSpace[]>([]);
const loading = ref(true);
const listError = ref('');
const drawerOpen = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);
const formError = ref('');
const actionError = ref('');
const success = ref('');

const form = reactive({
    name: '',
    description: '',
    icon: '🗂️',
    instructions: '',
});

async function load() {
    loading.value = true;
    listError.value = '';
    try {
        spaces.value = await $fetch<WorkSpace[]>('/api/spaces?includeArchived=1');
    } catch (e) {
        spaces.value = [];
        listError.value = extractApiError(e, t('spaces.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

function resetForm() {
    Object.assign(form, { name: '', description: '', icon: '🗂️', instructions: '' });
    formError.value = '';
}

function openCreate() {
    editingId.value = null;
    resetForm();
    drawerOpen.value = true;
}

function openEdit(space: WorkSpace) {
    editingId.value = space.id;
    Object.assign(form, { name: space.name, description: space.description, icon: space.icon, instructions: space.instructions });
    formError.value = '';
    drawerOpen.value = true;
}

async function save() {
    if (saving.value) return;
    const name = form.name.trim();
    if (!name) {
        formError.value = t('spaces.nameRequired');
        return;
    }
    saving.value = true;
    formError.value = '';
    actionError.value = '';
    try {
        const body = { name, description: form.description.trim(), icon: form.icon.trim() || '🗂️', instructions: form.instructions.trim() };
        if (editingId.value) {
            await $fetch(`/api/spaces/${encodeURIComponent(editingId.value)}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/spaces', { method: 'POST', body });
            success.value = t('spaces.created');
        }
        drawerOpen.value = false;
        await load();
        await refreshSpaces();
    } catch (e) {
        formError.value = extractApiError(e, t('spaces.saveFailed'));
    } finally {
        saving.value = false;
    }
}

async function remove(space: WorkSpace) {
    if (!confirm(t('spaces.deleteConfirm', { name: space.name }))) return;
    actionError.value = '';
    try {
        await $fetch(`/api/spaces/${encodeURIComponent(space.id)}`, { method: 'DELETE' });
        success.value = t('spaces.deleted');
        await load();
        await refreshSpaces();
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    }
}

async function openSpace(space: WorkSpace) {
    if (space.archived) return;
    await navigateTo(`/spaces/${encodeURIComponent(space.id)}`);
}

async function toggleArchive(space: WorkSpace) {
    actionError.value = '';
    try {
        await $fetch(`/api/spaces/${encodeURIComponent(space.id)}`, { method: 'PATCH', body: { archived: !space.archived } });
        success.value = space.archived ? t('spaces.restored') : t('spaces.archivedMessage');
        await load();
        await refreshSpaces();
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    }
}
</script>

<template>
    <div class="space-y-5">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ t('spaces.title') }}</h1>
                <p class="app-page-subtitle">{{ t('spaces.subtitle') }}</p>
            </div>
            <button type="button" class="app-btn app-btn-primary !px-3 !py-1.5 !text-xs" @click="openCreate">
                <AppIcon name="plus" :size="14" />
                <span>{{ t('spaces.new') }}</span>
            </button>
        </div>

        <div v-if="listError" class="app-alert app-alert-danger flex items-center justify-between gap-3">
            <span>{{ listError }}</span>
            <button type="button" class="app-btn app-btn-soft shrink-0 !py-1.5" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div v-if="actionError" class="app-alert app-alert-danger flex items-center justify-between gap-3">
            <span>{{ actionError }}</span>
            <button type="button" class="app-btn app-btn-ghost !px-2 !py-1" @click="actionError = ''">✕</button>
        </div>
        <div v-if="success" class="app-alert app-alert-success">{{ success }}</div>

        <div v-if="loading" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div v-for="i in 6" :key="i" class="app-skeleton app-skeleton-card" />
        </div>

        <div v-else-if="spaces.length" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <article v-for="space in spaces" :key="space.id" class="app-card flex flex-col p-5">
                <div class="flex items-start gap-3">
                    <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--surface-3)] text-2xl">{{ space.icon }}</span>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                            <h2 class="text-strong truncate text-sm font-black">{{ space.name }}</h2>
                            <span v-if="space.id === 'default'" class="app-chip app-chip-brand !text-[9px]">{{ t('spaces.defaultBadge') }}</span>
                            <span v-if="space.archived" class="app-badge app-badge-neutral !text-[9px]">{{ t('spaces.archived') }}</span>
                        </div>
                        <p class="text-faint mt-1 line-clamp-2 text-xs">{{ space.description || t('common.none') }}</p>
                    </div>
                </div>

                <div class="text-faint mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                    <span>{{ t('spaces.conversations', { n: space.conversationCount }) }}</span>
                    <span>{{ t('spaces.schedules', { n: space.scheduleCount }) }}</span>
                    <span>{{ t('spaces.files', { n: space.attachmentCount }) }}</span>
                    <span>{{ t('spaces.knowledgeBases', { n: space.knowledgeBaseCount }) }}</span>
                    <span>{{ t('spaces.documents', { n: space.documentCount }) }}</span>
                </div>

                <div class="mt-auto flex flex-wrap items-center gap-2 pt-5">
                    <button v-if="!space.archived" type="button" class="app-btn app-btn-primary app-btn-sm" @click="openSpace(space)">{{ t('spaces.openSpace') }}</button>
                    <button v-else type="button" class="app-btn app-btn-primary app-btn-sm" @click="toggleArchive(space)">{{ t('spaces.restore') }}</button>
                    <button type="button" class="app-btn app-btn-outline app-btn-sm" @click="openEdit(space)">{{ t('common.edit') }}</button>
                    <button v-if="!space.archived && space.id !== 'default'" type="button" class="app-btn app-btn-ghost app-btn-sm" @click="toggleArchive(space)">
                        {{ t('spaces.archive') }}
                    </button>
                    <button
                        v-if="space.id !== 'default'"
                        type="button"
                        class="app-btn app-btn-ghost app-btn-sm ml-auto !text-[color:var(--danger)]"
                        @click="remove(space)"
                    >
                        {{ t('common.delete') }}
                    </button>
                </div>
            </article>
        </div>

        <div v-else class="app-empty">
            <AppIcon name="folder-outline" :size="30" class="app-empty-icon" />
            <p class="app-empty-title">{{ t('spaces.empty') }}</p>
            <p class="app-empty-desc">{{ t('spaces.emptyHint') }}</p>
        </div>

        <AdminDrawer :open="drawerOpen" :title="editingId ? t('spaces.edit') : t('spaces.new')" width-class="sm:max-w-xl" @close="drawerOpen = false">
            <div class="space-y-4">
                <label class="block">
                    <span class="app-dropdown-label !px-0">{{ t('spaces.name') }}</span>
                    <input v-model="form.name" class="app-input" maxlength="60" :placeholder="t('spaces.namePlaceholder')" />
                </label>
                <div class="grid grid-cols-[90px_minmax(0,1fr)] gap-3">
                    <label class="block">
                        <span class="app-dropdown-label !px-0">{{ t('spaces.icon') }}</span>
                        <input v-model="form.icon" class="app-input text-center" maxlength="16" :placeholder="t('spaces.iconPlaceholder')" />
                    </label>
                    <label class="block">
                        <span class="app-dropdown-label !px-0">{{ t('spaces.description') }}</span>
                        <input v-model="form.description" class="app-input" maxlength="500" :placeholder="t('spaces.descPlaceholder')" />
                    </label>
                </div>
                <label class="block">
                    <span class="app-dropdown-label !px-0">{{ t('spaces.instructions') }}</span>
                    <textarea v-model="form.instructions" class="app-input" rows="8" maxlength="4000" />
                    <span class="text-faint mt-1 block text-[11px]">{{ t('spaces.instructionsHint') }}</span>
                </label>
                <p v-if="formError" class="app-help-error">{{ formError }}</p>
            </div>
            <template #footer>
                <div class="flex w-full items-center justify-end gap-2">
                    <button type="button" class="app-btn app-btn-ghost" :disabled="saving" @click="drawerOpen = false">{{ t('common.cancel') }}</button>
                    <button type="button" class="app-btn app-btn-primary" :disabled="saving" @click="save">{{ t('common.save') }}</button>
                </div>
            </template>
        </AdminDrawer>
    </div>
</template>
