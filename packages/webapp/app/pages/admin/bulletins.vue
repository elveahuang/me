<script setup lang="ts">
import {
    BULLETIN_LEVELS,
    BULLETIN_POSITIONS,
    bulletinWindowText,
    dateInputToBoundary,
    extractApiError,
    isBulletinActive,
    isoToDateInput,
    type BulletinRecord,
} from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

const { t } = useI18n();

const items = ref<BulletinRecord[]>([]);
const loading = ref(false);
const error = ref('');
const success = ref('');
const saving = ref(false);
const editing = ref<Partial<BulletinRecord> | null>(null);

const emptyForm = () => ({
    title: '',
    content: '',
    imageUrl: '',
    linkUrl: '',
    linkText: '',
    position: 'home',
    level: 'info',
    enabled: true,
    sortOrder: 0,
    startsAt: '',
    endsAt: '',
});

const form = reactive(emptyForm());

async function load() {
    loading.value = true;
    error.value = '';
    try {
        const res = await $fetch<{ bulletins: BulletinRecord[] }>('/api/admin/bulletins');
        items.value = res.bulletins;
    } catch (e) {
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

function openCreate() {
    editing.value = {};
    Object.assign(form, emptyForm());
    error.value = '';
}

function openEdit(row: BulletinRecord) {
    editing.value = row;
    Object.assign(form, {
        title: row.title,
        content: row.content,
        imageUrl: row.imageUrl,
        linkUrl: row.linkUrl,
        linkText: row.linkText,
        position: row.position,
        level: row.level,
        enabled: row.enabled,
        sortOrder: row.sortOrder,
        startsAt: isoToDateInput(row.startsAt),
        endsAt: isoToDateInput(row.endsAt),
    });
    error.value = '';
}

async function save() {
    if (!form.title.trim()) {
        error.value = '标题必填';
        return;
    }
    saving.value = true;
    error.value = '';
    try {
        const body = {
            title: form.title,
            content: form.content,
            imageUrl: form.imageUrl,
            linkUrl: form.linkUrl,
            linkText: form.linkText,
            position: form.position,
            level: form.level,
            enabled: form.enabled,
            sortOrder: Number(form.sortOrder) || 0,
            // 开始取当天 00:00、结束取当天 23:59:59，保证结束日当天仍完整投放
            startsAt: dateInputToBoundary(form.startsAt, 'start')?.toISOString() ?? null,
            endsAt: dateInputToBoundary(form.endsAt, 'end')?.toISOString() ?? null,
        };
        if (editing.value?.id) {
            await $fetch(`/api/admin/bulletins/${editing.value.id}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/admin/bulletins', { method: 'POST', body });
        }
        success.value = t('common.saved');
        editing.value = null;
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    } finally {
        saving.value = false;
    }
}

async function toggleEnabled(row: BulletinRecord) {
    try {
        await $fetch(`/api/admin/bulletins/${row.id}`, { method: 'PATCH', body: { enabled: !row.enabled } });
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

async function remove(row: BulletinRecord) {
    if (!confirm(`确定删除「${row.title}」？`)) return;
    try {
        await $fetch(`/api/admin/bulletins/${row.id}`, { method: 'DELETE' });
        success.value = t('common.deleted');
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

function positionLabel(value: string) {
    return BULLETIN_POSITIONS.find((item) => item.value === value)?.label ?? value;
}

function levelLabel(value: string) {
    return BULLETIN_LEVELS.find((item) => item.value === value)?.label ?? value;
}
</script>

<template>
    <div class="space-y-6">
        <div class="app-page-header !mb-0">
            <div>
                <h1 class="app-page-title text-strong">{{ t('nav.bulletins') }}</h1>
                <p class="app-page-subtitle">配置首页 / 对话页 / 全站的宣传横幅与公告位</p>
            </div>
            <div class="app-page-actions">
                <button class="app-btn app-btn-primary" @click="openCreate">{{ t('admin.addRecord') }}</button>
            </div>
        </div>

        <div v-if="error" class="app-alert app-alert-danger">{{ error }}</div>
        <div v-if="success" class="app-alert app-alert-success">{{ success }}</div>

        <AdminDrawer :open="editing !== null" :title="editing?.id ? t('common.edit') : t('admin.addRecord')" width-class="sm:max-w-2xl" @close="editing = null">
            <div class="grid gap-3 sm:grid-cols-2">
                <input v-model="form.title" placeholder="标题" class="app-input sm:col-span-2" />
                <textarea v-model="form.content" rows="2" placeholder="内容描述" class="app-input sm:col-span-2" />
                <!-- 配图：可从附件选择或直接上传，避免手填会过期的预签名地址 -->
                <div class="sm:col-span-2">
                    <ImagePicker v-model="form.imageUrl" :placeholder="t('adminForm.bulletinImagePlaceholder')" />
                </div>
                <input v-model="form.linkUrl" placeholder="跳转链接，如 /pricing 或 https://…" class="app-input" />
                <input v-model="form.linkText" placeholder="按钮文案，如「了解详情」" class="app-input" />
                <select v-model="form.position" class="app-input">
                    <option v-for="p in BULLETIN_POSITIONS" :key="p.value" :value="p.value">{{ p.label }}</option>
                </select>
                <select v-model="form.level" class="app-input">
                    <option v-for="l in BULLETIN_LEVELS" :key="l.value" :value="l.value">{{ l.label }}</option>
                </select>
                <div class="flex items-center gap-2">
                    <span class="text-muted-2 shrink-0 text-xs">排序</span>
                    <input v-model.number="form.sortOrder" type="number" class="app-input !w-20" />
                </div>
                <label class="text-soft flex items-center gap-2 text-sm">
                    <input v-model="form.enabled" type="checkbox" class="app-checkbox" />
                    <span>{{ t('common.enabled') }}</span>
                </label>
                <div class="flex items-center gap-2">
                    <span class="text-muted-2 shrink-0 text-xs">开始</span>
                    <input v-model="form.startsAt" type="date" class="app-input !w-auto" />
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-muted-2 shrink-0 text-xs">结束</span>
                    <input v-model="form.endsAt" type="date" class="app-input !w-auto" />
                </div>
            </div>
            <template #footer>
                <button class="app-btn app-btn-ghost" @click="editing = null">{{ t('common.cancel') }}</button>
                <button class="app-btn app-btn-primary" :disabled="saving" @click="save">{{ t('common.save') }}</button>
            </template>
        </AdminDrawer>

        <div v-if="loading" class="space-y-3">
            <div v-for="i in 3" :key="i" class="app-skeleton h-20 !rounded-2xl" />
        </div>

        <div v-else-if="items.length" class="grid gap-3 sm:grid-cols-2">
            <div v-for="row in items" :key="row.id" class="app-card p-5">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                            <h3 class="text-strong truncate text-sm font-bold">{{ row.title }}</h3>
                            <span class="app-badge app-badge-info">{{ positionLabel(row.position) }}</span>
                            <span class="app-badge app-badge-neutral">{{ levelLabel(row.level) }}</span>
                            <span :class="isBulletinActive(row) ? 'app-badge-success' : 'app-badge-neutral'" class="app-badge">
                                {{ isBulletinActive(row) ? t('storage.activeRunning') : t('storage.activePending') }}
                            </span>
                        </div>
                        <p class="text-muted-2 mt-1.5 line-clamp-2 text-xs">{{ row.content || '—' }}</p>
                        <p class="text-faint mt-1.5 text-[11px] tabular-nums">
                            {{ t('storage.sortOrder') }} {{ row.sortOrder }} · {{ bulletinWindowText(row.startsAt, row.endsAt) }}
                        </p>
                    </div>
                    <div class="flex shrink-0 flex-col items-end gap-1">
                        <button class="app-btn app-btn-ghost app-btn-sm" @click="openEdit(row)">{{ t('common.edit') }}</button>
                        <button class="app-btn app-btn-ghost app-btn-sm" @click="toggleEnabled(row)">{{ row.enabled ? '停用' : '启用' }}</button>
                        <button class="app-btn app-btn-danger app-btn-sm" @click="remove(row)">{{ t('common.delete') }}</button>
                    </div>
                </div>
            </div>
        </div>

        <div v-else class="app-card p-12">
            <div class="app-empty">
                <span class="app-empty-icon">📣</span>
                <p class="app-empty-title">{{ t('admin.tableEmpty') }}</p>
                <p class="app-empty-desc">{{ t('admin.addRecord') }}</p>
            </div>
        </div>
    </div>
</template>
