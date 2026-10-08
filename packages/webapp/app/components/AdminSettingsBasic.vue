<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';

interface BasicSettings {
    siteTitle: string;
    defaultLocale: string;
    themeMode: string;
    themeBrand: string;
}

const { t } = useI18n();

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const { success, flashSuccess } = useFlashSuccess();
/** 是否成功拉到过真实配置：未拉到时不允许渲染可编辑表单，否则保存会把全局配置写回默认值 */
const loaded = ref(false);

const locales = [
    { key: 'zh-CN', label: '简体中文' },
    { key: 'en-US', label: 'English' },
];
const modes = [
    { key: 'light', label: 'adminForm.basicModeLight' },
    { key: 'dark', label: 'adminForm.basicModeDark' },
    { key: 'system', label: 'adminForm.basicModeSystem' },
];
const brands = [
    { key: 'blue', class: 'bg-blue-500', labelKey: 'adminForm.colorBlue' },
    { key: 'green', class: 'bg-emerald-500', labelKey: 'adminForm.colorGreen' },
    { key: 'yellow', class: 'bg-amber-500', labelKey: 'adminForm.colorYellow' },
    { key: 'red', class: 'bg-red-500', labelKey: 'adminForm.colorRed' },
];

const form = reactive<BasicSettings>({
    siteTitle: 'ME',
    defaultLocale: 'zh-CN',
    themeMode: 'system',
    themeBrand: 'green',
});

async function load() {
    loading.value = true;
    error.value = '';
    try {
        const data = await $fetch<BasicSettings>('/api/admin/system-settings');
        Object.assign(form, data);
        loaded.value = true;
    } catch (e) {
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

async function save() {
    if (saving.value) return;
    error.value = '';
    success.value = '';
    const title = form.siteTitle.trim();
    if (!title) {
        error.value = t('common.required', { field: t('adminForm.basicSiteTitle') });
        return;
    }
    saving.value = true;
    try {
        const next = await $fetch<BasicSettings>('/api/admin/system-settings', {
            method: 'PATCH',
            body: {
                siteTitle: title,
                defaultLocale: form.defaultLocale,
                themeMode: form.themeMode,
                themeBrand: form.themeBrand,
            },
        });
        Object.assign(form, next);
        flashSuccess(t('common.saved'));
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <div class="space-y-4">
        <p class="text-faint text-xs">{{ t('settings.basicHint') }}</p>

        <div v-if="error" class="app-alert app-alert-danger">
            {{ error }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div v-if="success" class="app-alert app-alert-success">{{ success }}</div>

        <div v-if="loading" class="app-skeleton h-64 !rounded-2xl" />
        <div v-else-if="loaded" class="app-card space-y-6 p-6">
            <div class="space-y-1.5">
                <label for="settings-site-title" class="text-strong text-sm font-bold">{{ t('adminForm.basicSiteTitle') }}</label>
                <input
                    id="settings-site-title"
                    v-model="form.siteTitle"
                    maxlength="60"
                    :placeholder="t('adminForm.basicSiteTitlePlaceholder')"
                    class="app-input max-w-md"
                />
                <p class="text-faint text-[11px]">{{ t('adminForm.basicSiteTitleHint') }}</p>
            </div>

            <div class="space-y-1.5">
                <label for="settings-default-locale" class="text-strong text-sm font-bold">{{ t('adminForm.basicDefaultLocale') }}</label>
                <select id="settings-default-locale" v-model="form.defaultLocale" class="app-input max-w-md">
                    <option v-for="option in locales" :key="option.key" :value="option.key">{{ option.label }}</option>
                </select>
                <p class="text-faint text-[11px]">{{ t('adminForm.basicDefaultLocaleHint') }}</p>
            </div>

            <div class="space-y-1.5">
                <p id="settings-theme-mode-label" class="text-strong text-sm font-bold">{{ t('adminForm.basicThemeMode') }}</p>
                <div role="group" aria-labelledby="settings-theme-mode-label" class="app-segmented">
                    <button
                        v-for="item in modes"
                        :key="item.key"
                        type="button"
                        class="app-segmented-item"
                        :aria-pressed="form.themeMode === item.key"
                        @click="form.themeMode = item.key"
                    >
                        <span>{{ t(item.label) }}</span>
                    </button>
                </div>
            </div>

            <div class="space-y-1.5">
                <p id="settings-theme-brand-label" class="text-strong text-sm font-bold">{{ t('adminForm.basicThemeBrand') }}</p>
                <div role="group" aria-labelledby="settings-theme-brand-label" class="flex gap-2.5">
                    <button
                        v-for="swatch in brands"
                        :key="swatch.key"
                        type="button"
                        class="h-8 w-8 rounded-full transition"
                        :class="[swatch.class, form.themeBrand === swatch.key ? 'ring-brand' : 'hover:opacity-75']"
                        :aria-label="t('adminForm.brandColorOption', { color: t(swatch.labelKey) })"
                        :aria-pressed="form.themeBrand === swatch.key"
                        @click="form.themeBrand = swatch.key"
                    />
                </div>
                <p class="text-faint text-[11px]">{{ t('adminForm.basicThemeHint') }}</p>
            </div>

            <div class="border-line flex justify-end border-t pt-4">
                <button class="app-btn app-btn-primary" type="button" :disabled="saving" @click="save">
                    {{ saving ? t('common.loading') : t('common.save') }}
                </button>
            </div>
        </div>
    </div>
</template>
