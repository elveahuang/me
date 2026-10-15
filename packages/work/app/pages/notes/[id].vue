<script setup lang="ts">
import { extractApiError, formatDateTime } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import type { WorkNote, WorkProject } from '../../utils/work';

/**
 * 笔记编辑器。
 *
 * 自动保存的口径：改动停止 1.2 秒后 PATCH **变化的字段**，而不是整篇覆盖——
 * 整篇覆盖会把「另一处（AI 工具 / 命令面板）刚写入的字段」抹掉，
 * 只发 diff 时服务端逐字段归一，冲突面小得多。
 *
 * 正文一变，服务端会清空摘要与向量并异步重建索引（`scheduleNoteIndex`），
 * 所以这里显示「索引稍后更新」，而不是假装摘要立刻可用。
 */
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const id = String(route.params.id ?? '');

const { data: note, status: noteStatus } = await useFetch<WorkNote>(`/api/notes/${encodeURIComponent(id)}`, { lazy: true });
const { data: projects } = useFetch<WorkProject[]>('/api/projects', { lazy: true, default: () => [] });

const title = ref('');
const content = ref('');
const tags = ref<string[]>([]);
const projectId = ref('');
const kind = ref<'note' | 'daily'>('note');
const pinned = ref(false);

const preview = ref(false);
const dirty = ref(false);
const saving = ref(false);
const savedAt = ref('');
const actionError = ref('');
const bodyRef = ref<HTMLTextAreaElement | null>(null);
const tagDraft = ref('');

/** 首次填充表单时不能把「载入」当成「用户改动」，否则一进页面就自动保存一次 */
let hydrated = false;

watch(
    note,
    (value) => {
        if (!value) return;
        hydrated = false;
        title.value = value.title ?? '';
        content.value = value.content ?? '';
        tags.value = Array.isArray(value.tags) ? [...value.tags] : [];
        projectId.value = value.projectId ?? '';
        kind.value = value.kind === 'daily' ? 'daily' : 'note';
        pinned.value = !!value.pinned;
        void nextTick(() => (hydrated = true));
    },
    { immediate: true },
);

watch([title, content, tags, projectId, kind, pinned], () => {
    if (hydrated) dirty.value = true;
});

let timer: ReturnType<typeof setTimeout> | null = null;
watch(dirty, (value) => {
    if (timer) clearTimeout(timer);
    if (!value) return;
    timer = setTimeout(() => void save(), 1200);
});
onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
});

/** 只带上与已加载行不一致的字段 */
function changedFields(): Record<string, unknown> {
    const base = note.value;
    if (!base) return {};
    const patch: Record<string, unknown> = {};
    if (title.value !== (base.title ?? '')) patch.title = title.value;
    if (content.value !== (base.content ?? '')) patch.content = content.value;
    if (tags.value.join('|') !== (base.tags ?? []).join('|')) patch.tags = tags.value;
    if (projectId.value !== (base.projectId ?? '')) patch.projectId = projectId.value || null;
    if (kind.value !== base.kind) patch.kind = kind.value;
    if (pinned.value !== !!base.pinned) patch.pinned = pinned.value;
    return patch;
}

async function save(): Promise<boolean> {
    if (saving.value) return false;
    const patch = changedFields();
    if (!Object.keys(patch).length) {
        dirty.value = false;
        return true;
    }
    saving.value = true;
    actionError.value = '';
    try {
        const saved = await $fetch<WorkNote>(`/api/notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
        note.value = saved;
        savedAt.value = formatDateTime(saved.updatedAt);
        // 保存期间用户又敲了字：dirty 仍为 true，下面这次复位会把它抹掉，
        // 所以只在「这段时间没有新改动」时才清标志（否则未保存的编辑会在下次停顿前显示成已保存）。
        if (content.value === saved.content && title.value === saved.title) dirty.value = false;
        return true;
    } catch (e) {
        actionError.value = extractApiError(e, t('work.saveFailed'));
        return false;
    } finally {
        saving.value = false;
    }
}

function commitTagDraft() {
    const value = tagDraft.value.trim().replace(/^#/, '');
    if (value && !tags.value.includes(value)) tags.value = [...tags.value, value].slice(0, 20);
    tagDraft.value = '';
}

function removeTag(tag: string) {
    tags.value = tags.value.filter((item) => item !== tag);
}

async function togglePin() {
    pinned.value = !pinned.value;
    await save();
}

async function removeNote() {
    if (!confirm(t('work.deleteNoteConfirm', { title: title.value || t('work.untitledNote') }))) return;
    try {
        await $fetch(`/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await navigateTo('/notes');
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    }
}

async function askAiAboutThis() {
    const excerpt = (content.value || title.value).slice(0, 400);
    if (!excerpt.trim()) return;
    await save();
    await navigateTo(`/?ask=${encodeURIComponent(`${t('work.askAboutNote')}\n${excerpt}`)}`);
}

/** Ctrl/Cmd+S 立刻保存（不等防抖）；在输入框里也不该被浏览器「保存网页」抢走 */
function onKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save().then((ok) => ok && flashSaved());
    }
}
const { flashSuccess } = useFlashSuccess();
function flashSaved() {
    flashSuccess(t('work.noteSaved'));
}

onMounted(() => {
    if (import.meta.client) window.addEventListener('keydown', onKeydown);
    if (route.query.new === '1') {
        void nextTick(() => bodyRef.value?.focus());
        router.replace({ query: {} });
    }
});
onBeforeUnmount(() => {
    if (import.meta.client) window.removeEventListener('keydown', onKeydown);
});

const charCount = computed(() => content.value.length);
const notFound = computed(() => noteStatus.value === 'success' && !note.value);
</script>

<template>
    <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-2">
            <NuxtLink to="/notes" class="app-btn app-btn-ghost app-btn-icon" :aria-label="t('work.backToNotes')">
                <AppIcon name="arrow-left" :size="18" />
            </NuxtLink>
            <input
                v-model="title"
                class="app-input min-w-0 flex-1 !border-transparent !bg-transparent !px-0 !text-xl !font-black tracking-tight"
                :placeholder="t('work.untitledNote')"
                maxlength="200"
                :aria-label="t('work.fieldTitle')"
            />
            <div class="flex items-center gap-2 text-[11px]">
                <span v-if="saving" class="text-faint flex items-center gap-1"
                    ><AppIcon name="autorenew" :size="12" class="animate-spin" />{{ t('work.saving') }}</span
                >
                <span v-else-if="dirty" class="app-badge app-badge-warning">{{ t('work.unsaved') }}</span>
                <span v-else-if="savedAt" class="text-faint">{{ t('work.savedAt', { at: savedAt }) }}</span>
            </div>
        </div>

        <div v-if="actionError" class="app-alert app-alert-danger flex items-center gap-2">
            <AppIcon name="alert-outline" :size="16" />
            <span class="min-w-0 flex-1">{{ actionError }}</span>
            <button type="button" class="app-btn app-btn-soft !px-3 !py-1 !text-[10px]" @click="save">{{ t('common.retry') }}</button>
        </div>

        <div v-if="notFound" class="app-empty">
            <AppIcon name="file-outline" :size="30" class="app-empty-icon" />
            <p class="app-empty-title">{{ t('work.noteMissing') }}</p>
            <p class="app-empty-desc">{{ t('work.noteMissingHint') }}</p>
        </div>

        <template v-else>
            <div class="flex flex-wrap items-center gap-2">
                <div class="app-segmented" role="group" :aria-label="t('work.editMode')">
                    <button type="button" class="app-segmented-item" :aria-pressed="!preview" @click="preview = false">{{ t('work.modeEdit') }}</button>
                    <button type="button" class="app-segmented-item" :aria-pressed="preview" @click="preview = true">{{ t('work.modePreview') }}</button>
                </div>
                <select v-model="kind" class="app-input !w-auto !text-xs" :aria-label="t('work.fieldKind')">
                    <option value="note">{{ t('work.kindNote') }}</option>
                    <option value="daily">{{ t('work.kindDaily') }}</option>
                </select>
                <select v-model="projectId" class="app-input !w-auto max-w-[10rem] truncate !text-xs" :aria-label="t('work.fieldProject')">
                    <option value="">{{ t('work.noProject') }}</option>
                    <option v-for="p in projects ?? []" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
                <button type="button" class="app-btn app-btn-outline !px-3 !py-1.5 !text-[11px]" :aria-pressed="pinned" @click="togglePin">
                    <AppIcon name="pin-outline" :size="13" />
                    <span>{{ pinned ? t('work.pinned') : t('work.pin') }}</span>
                </button>
                <button type="button" class="app-btn app-btn-ghost !px-3 !py-1.5 !text-[11px]" :disabled="!content && !title" @click="askAiAboutThis">
                    <AppIcon name="robot-outline" :size="13" />
                    <span>{{ t('work.askAi') }}</span>
                </button>
                <button type="button" class="app-btn app-btn-ghost ml-auto !px-3 !py-1.5 !text-[11px]" :aria-label="t('common.delete')" @click="removeNote">
                    <AppIcon name="trash-can-outline" :size="13" />
                </button>
            </div>

            <div class="flex flex-wrap items-center gap-1.5">
                <AppIcon name="tag-outline" :size="14" class="text-faint" />
                <span v-for="tag in tags" :key="tag" class="app-chip app-chip-brand !px-2 !py-0.5 !text-[11px]">
                    {{ tag }}
                    <button type="button" class="ml-1 opacity-70 hover:opacity-100" :aria-label="t('work.removeTag', { tag })" @click="removeTag(tag)">
                        ×
                    </button>
                </span>
                <input
                    v-model="tagDraft"
                    class="app-input !w-32 !px-2 !py-1 !text-[11px]"
                    :placeholder="t('work.addTag')"
                    :aria-label="t('work.addTag')"
                    @keydown.enter.prevent="commitTagDraft"
                    @blur="commitTagDraft"
                />
            </div>

            <div class="app-card overflow-hidden">
                <textarea
                    v-if="!preview"
                    ref="bodyRef"
                    v-model="content"
                    class="app-input min-h-[60vh] w-full resize-y !border-0 !bg-transparent font-mono !text-[13px] leading-relaxed"
                    :placeholder="t('work.noteContentPlaceholder')"
                    :aria-label="t('work.noteContentPlaceholder')"
                />
                <div v-else class="max-w-none p-4">
                    <MarkdownContent :value="content || t('work.emptyNote')" />
                </div>
            </div>

            <div class="text-faint flex flex-wrap items-center gap-3 text-[11px]">
                <span>{{ t('work.charCount', { n: charCount }) }}</span>
                <span v-if="note?.summary">{{ t('work.summaryReady') }}</span>
                <span v-else>{{ t('work.summaryPending') }}</span>
                <span v-if="note">{{ t('work.createdAt', { at: formatDateTime(note.createdAt) }) }}</span>
            </div>
        </template>
    </div>
</template>
