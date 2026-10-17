<script setup lang="ts">
import { extractApiError, formatDateTime } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import type { WorkNote } from '../utils/work';

/**
 * 笔记页：列表 + 两种检索。
 *
 * 关键词输入只做字面筛选（`GET /api/notes?keyword=`，无外呼、随敲随筛）；
 * 「按意思找」是另一个动作（回车或点按钮）走 `/api/notes/search`——那条要打嵌入端点，
 * 把它绑在每次按键上等于让用户边打字边烧供应商配额。
 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();

/** 初值取自 URL：深链（`?kind=&tag=&q=`）要能还原出同一个筛选结果，不读就等于书签失效 */
const readQuery = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '');
const keywordInput = ref(readQuery('q'));
const keyword = ref(keywordInput.value);
const kindFilter = ref(readQuery('kind'));
const tagFilter = ref(readQuery('tag'));

watch([kindFilter, tagFilter, keyword], () => {
    router.replace({
        query: {
            ...route.query,
            kind: kindFilter.value || undefined,
            tag: tagFilter.value || undefined,
            q: keyword.value || undefined,
        },
    });
});

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(keywordInput, (value) => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => (keyword.value = value.trim()), 300);
});
onBeforeUnmount(() => {
    if (searchTimer) clearTimeout(searchTimer);
});

const listQuery = computed(() => ({
    kind: kindFilter.value || undefined,
    tag: tagFilter.value || undefined,
    keyword: keyword.value || undefined,
    limit: '120',
}));

const { data: notes, pending, error, refresh } = await useFetch<WorkNote[]>('/api/notes', { query: listQuery, lazy: true, default: () => [] });

const { data: indexState, refresh: refreshIndex } = useFetch<{ unindexed: number; batchMax: number; embedding: { provider: string; model: string } | null }>(
    '/api/notes/reindex',
    { lazy: true },
);

const loadFailed = computed(() => !!error.value);
const actionError = ref('');
const { success, flashSuccess } = useFlashSuccess();

interface SemanticHit {
    id: string;
    title: string;
    summary: string;
    updatedAt: string;
    score: number;
    mode: 'vector' | 'keyword';
}
interface SemanticResult {
    q: string;
    mode: string;
    staleVectors: number;
    hits: SemanticHit[];
}
const semantic = ref<SemanticResult | null>(null);
const semanticBusy = ref(false);

async function runSemantic() {
    const q = keywordInput.value.trim();
    if (!q) return;
    semanticBusy.value = true;
    actionError.value = '';
    try {
        semantic.value = await $fetch<SemanticResult>('/api/notes/search', { query: { q, limit: 12 } });
    } catch (e) {
        actionError.value = extractApiError(e, t('work.searchFailed'));
    } finally {
        semanticBusy.value = false;
    }
}

function clearSemantic() {
    semantic.value = null;
}

const creating = ref(false);
async function createNote() {
    if (creating.value) return;
    creating.value = true;
    try {
        const note = await $fetch<WorkNote>('/api/notes', { method: 'POST', body: { title: t('work.untitledNote'), content: '' } });
        await navigateTo(`/notes/${encodeURIComponent(note.id)}?new=1`);
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    } finally {
        creating.value = false;
    }
}

/** 「新建笔记」的深链：先清标志再建笔记，避免重挂载时重复 POST（必须在 onMounted 里消费，写在 setup 顶层会让 SSR 首屏就带着一次创建） */
onMounted(() => {
    if (route.query.new !== '1') return;
    void router.replace({ query: { ...route.query, new: undefined } });
    void createNote();
});

async function removeNote(note: WorkNote) {
    if (!confirm(t('work.deleteNoteConfirm', { title: note.title || t('work.untitledNote') }))) return;
    try {
        await $fetch(`/api/notes/${encodeURIComponent(note.id)}`, { method: 'DELETE' });
        flashSuccess(t('common.deleted'));
        clearSemantic();
        await refresh();
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    }
}

async function togglePin(note: WorkNote) {
    try {
        await $fetch(`/api/notes/${encodeURIComponent(note.id)}`, { method: 'PATCH', body: { pinned: !note.pinned } });
        await refresh();
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    }
}

const rebuilding = ref(false);
async function rebuildIndex() {
    if (rebuilding.value) return;
    rebuilding.value = true;
    actionError.value = '';
    try {
        const result = await $fetch<{ indexed: number; scanned: number; skipped: number; unindexed: number }>('/api/notes/reindex', {
            method: 'POST',
            body: {},
        });
        flashSuccess(t('work.indexRun', { indexed: result.indexed, scanned: result.scanned, left: result.unindexed }));
        await refreshIndex();
    } catch (e) {
        actionError.value = extractApiError(e, t('work.indexFailed'));
    } finally {
        rebuilding.value = false;
    }
}

const allTags = computed(() => {
    const set = new Set<string>();
    for (const note of notes.value ?? []) for (const tag of note.tags ?? []) set.add(tag);
    return [...set].slice(0, 24);
});
</script>

<template>
    <div class="space-y-5">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title">{{ t('work.notesTitle') }}</h1>
                <p class="app-page-subtitle">{{ t('work.notesSubtitle', { n: (notes ?? []).length }) }}</p>
            </div>
            <div class="app-page-actions">
                <button type="button" class="app-btn app-btn-primary" :disabled="creating" @click="createNote">
                    <AppIcon name="plus" :size="16" />
                    <span>{{ t('work.newNote') }}</span>
                </button>
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <div class="relative min-w-0 flex-1 sm:max-w-sm">
                <AppIcon name="magnify" :size="15" class="text-faint pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
                <input
                    v-model="keywordInput"
                    class="app-input !pl-8 !text-xs"
                    :placeholder="t('work.searchNotes')"
                    :aria-label="t('work.searchNotes')"
                    @keydown.enter.prevent="runSemantic"
                />
                <button
                    v-if="keywordInput.trim()"
                    type="button"
                    class="text-faint absolute top-1/2 right-2 -translate-y-1/2"
                    :aria-label="t('common.clear')"
                    @click="
                        keywordInput = '';
                        clearSemantic();
                    "
                >
                    <AppIcon name="close-circle-outline" :size="14" />
                </button>
            </div>
            <button
                type="button"
                class="app-btn app-btn-outline !px-3 !py-1.5 !text-[11px]"
                :disabled="semanticBusy || !keywordInput.trim()"
                @click="runSemantic"
            >
                <AppIcon :name="semanticBusy ? 'autorenew' : 'brain'" :size="13" :class="semanticBusy ? 'animate-spin' : ''" />
                <span>{{ semanticBusy ? t('work.searching') : t('work.searchSemantic') }}</span>
            </button>
            <select v-model="kindFilter" class="app-input !w-auto !text-xs" :aria-label="t('work.fieldKind')">
                <option value="">{{ t('work.kindAll') }}</option>
                <option value="note">{{ t('work.kindNote') }}</option>
                <option value="daily">{{ t('work.kindDaily') }}</option>
            </select>
        </div>

        <div v-if="allTags.length" class="flex flex-wrap items-center gap-1.5">
            <AppIcon name="tag-outline" :size="14" class="text-faint" />
            <button
                v-for="tag in allTags"
                :key="tag"
                type="button"
                class="app-chip"
                :class="tagFilter === tag ? 'app-chip-brand' : ''"
                :aria-pressed="tagFilter === tag"
                @click="tagFilter = tagFilter === tag ? '' : tag"
            >
                {{ tag }}
            </button>
        </div>

        <div class="flex flex-wrap items-center gap-2 text-[11px]">
            <span class="text-faint flex items-center gap-1">
                <AppIcon name="database-outline" :size="13" />
                {{ indexState?.embedding ? t('work.indexModelSet', { model: indexState.embedding.model }) : t('work.indexNoModel') }}
            </span>
            <span v-if="indexState && indexState.unindexed > 0" class="app-badge app-badge-warning">{{
                t('work.indexPending', { n: indexState.unindexed })
            }}</span>
            <span v-else-if="indexState" class="app-badge app-badge-success">{{ t('work.indexUpToDate') }}</span>
            <button
                type="button"
                class="app-btn app-btn-soft !px-2.5 !py-1 !text-[10px]"
                :disabled="rebuilding || !indexState?.unindexed"
                @click="rebuildIndex"
            >
                <AppIcon name="autorenew" :size="12" :class="rebuilding ? 'animate-spin' : ''" />
                <span>{{ rebuilding ? t('work.indexing') : t('work.indexRebuild') }}</span>
            </button>
        </div>

        <div v-if="loadFailed" class="app-alert app-alert-danger flex items-center gap-2">
            <AppIcon name="alert-outline" :size="16" />
            <span class="min-w-0 flex-1">{{ extractApiError(error, t('common.loadFailed')) }}</span>
            <button type="button" class="app-btn app-btn-soft !px-3 !py-1 !text-[10px]" @click="refresh()">{{ t('common.retry') }}</button>
        </div>
        <div v-if="actionError" class="app-alert app-alert-danger flex items-center gap-2">
            <AppIcon name="alert-outline" :size="16" />
            <span class="min-w-0 flex-1">{{ actionError }}</span>
            <button type="button" class="app-btn app-btn-ghost app-btn-icon !h-6 !w-6" :aria-label="t('common.close')" @click="actionError = ''">
                <AppIcon name="close" :size="13" />
            </button>
        </div>
        <div v-if="success" class="app-alert app-alert-success">
            <AppIcon name="check-circle-outline" :size="16" />
            <span>{{ success }}</span>
        </div>

        <!-- 语义结果：与字面列表分开渲染，并说明命中方式，避免把「近似」读成「就是这条」 -->
        <section v-if="semantic" class="app-card p-4">
            <div class="flex items-center gap-2">
                <h2 class="text-xs font-black"><AppIcon name="brain" :size="13" class="mr-1 inline" />{{ t('work.semanticFor', { q: semantic.q }) }}</h2>
                <span class="app-badge app-badge-info">{{ semantic.mode === 'vector' ? t('work.modeVector') : t('work.modeKeyword') }}</span>
                <button type="button" class="text-hover-muted ml-auto text-[11px]" @click="clearSemantic">{{ t('common.close') }}</button>
            </div>
            <p v-if="semantic.staleVectors" class="app-help-error mt-2">{{ t('work.staleVectors', { n: semantic.staleVectors }) }}</p>
            <ul v-if="semantic.hits.length" class="mt-3 space-y-2">
                <li v-for="hit in semantic.hits" :key="hit.id" class="app-list-row">
                    <NuxtLink :to="`/notes/${encodeURIComponent(hit.id)}`" class="min-w-0 flex-1">
                        <p class="truncate text-sm font-medium">{{ hit.title || t('work.untitledNote') }}</p>
                        <p class="text-faint mt-1 line-clamp-2 text-[11px]">{{ hit.summary }}</p>
                    </NuxtLink>
                    <span class="text-faint shrink-0 text-[10px]">{{ hit.score.toFixed(2) }}</span>
                </li>
            </ul>
            <p v-else class="text-faint mt-3 text-xs">{{ t('work.searchEmpty') }}</p>
        </section>

        <div v-if="pending && !(notes ?? []).length" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div v-for="i in 6" :key="i" class="app-skeleton h-32" />
        </div>

        <div v-else-if="(notes ?? []).length" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <article v-for="note in notes ?? []" :key="note.id" class="app-card app-card-hover group flex flex-col gap-2 p-4">
                <div class="flex items-start gap-2">
                    <NuxtLink :to="`/notes/${encodeURIComponent(note.id)}`" class="min-w-0 flex-1">
                        <h3 class="truncate text-sm font-bold">{{ note.title || t('work.untitledNote') }}</h3>
                    </NuxtLink>
                    <span v-if="note.pinned" class="app-badge app-badge-info shrink-0"><AppIcon name="pin-outline" :size="11" /></span>
                </div>
                <NuxtLink :to="`/notes/${encodeURIComponent(note.id)}`" class="text-faint line-clamp-3 flex-1 text-xs">
                    {{ note.summary || note.excerpt || t('work.emptyNote') }}
                </NuxtLink>
                <div class="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span v-if="note.kind === 'daily'" class="app-badge app-badge-neutral">{{ t('work.kindDaily') }}</span>
                    <span v-for="tag in (note.tags ?? []).slice(0, 3)" :key="tag" class="app-chip !px-2 !py-0.5 !text-[10px]">{{ tag }}</span>
                </div>
                <div class="app-divider flex items-center gap-2 pt-1 text-[10px]">
                    <span class="text-faint">{{ formatDateTime(note.updatedAt) }}</span>
                    <div class="app-hover-reveal ml-auto flex items-center gap-1">
                        <button
                            type="button"
                            class="app-btn app-btn-ghost app-btn-icon app-btn-sm"
                            :aria-label="note.pinned ? t('work.unpin') : t('work.pin')"
                            @click="togglePin(note)"
                        >
                            <AppIcon name="pin-outline" :size="13" />
                        </button>
                        <button type="button" class="app-btn app-btn-ghost app-btn-icon app-btn-sm" :aria-label="t('common.delete')" @click="removeNote(note)">
                            <AppIcon name="trash-can-outline" :size="13" />
                        </button>
                    </div>
                </div>
            </article>
        </div>

        <div v-else-if="!loadFailed" class="app-empty">
            <AppIcon name="book-open-page-variant-outline" :size="30" class="app-empty-icon" />
            <p class="app-empty-title">{{ keyword || tagFilter || kindFilter ? t('work.noMatch') : t('work.noNotesYet') }}</p>
            <p class="app-empty-desc">{{ t('work.noNotesHint') }}</p>
        </div>
    </div>
</template>
