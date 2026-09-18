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

const loading = ref(false);
const saving = ref(false);
const error = ref('');
const success = ref('');
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
    { key: 'blue', class: 'bg-blue-500' },
    { key: 'green', class: 'bg-emerald-500' },
    { key: 'yellow', class: 'bg-amber-500' },
    { key: 'red', class: 'bg-red-500' },
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
    error.value = '';
    success.value = '';
    const title = form.siteTitle.trim();
    if (!title) {
        error.value = t('adminForm.basicSiteTitle') + ' / ' + t('common.error');
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
        success.value = t('common.saved');
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <div class="space-y-4">
        <p class="text-xs text-gray-400">{{ t('settings.basicHint') }}</p>

        <div v-if="error" class="rounded-xl bg-red-50 p-3 text-sm text-red-600">
            {{ error }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div v-if="success" class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{{ success }}</div>

        <div v-if="loading" class="h-64 animate-pulse rounded-2xl bg-white" />
        <div v-else-if="loaded" class="space-y-6 rounded-2xl bg-white p-6 shadow-sm">
            <div class="space-y-1.5">
                <label class="text-sm font-bold text-gray-700">{{ t('adminForm.basicSiteTitle') }}</label>
                <input
                    v-model="form.siteTitle"
                    maxlength="60"
                    :placeholder="t('adminForm.basicSiteTitlePlaceholder')"
                    class="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <p class="text-[11px] text-gray-400">{{ t('adminForm.basicSiteTitleHint') }}</p>
            </div>

            <div class="space-y-1.5">
                <label class="text-sm font-bold text-gray-700">{{ t('adminForm.basicDefaultLocale') }}</label>
                <select v-model="form.defaultLocale" class="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    <option v-for="option in locales" :key="option.key" :value="option.key">{{ option.label }}</option>
                </select>
                <p class="text-[11px] text-gray-400">{{ t('adminForm.basicDefaultLocaleHint') }}</p>
            </div>

            <div class="space-y-1.5">
                <label class="text-sm font-bold text-gray-700">{{ t('adminForm.basicThemeMode') }}</label>
                <div class="flex gap-2">
                    <button
                        v-for="item in modes"
                        :key="item.key"
                        type="button"
                        class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors"
                        :class="
                            form.themeMode === item.key ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                        "
                        @click="form.themeMode = item.key"
                    >
                        <span>{{ t(item.label) }}</span>
                    </button>
                </div>
            </div>

            <div class="space-y-1.5">
                <label class="text-sm font-bold text-gray-700">{{ t('adminForm.basicThemeBrand') }}</label>
                <div class="flex gap-2.5">
                    <button
                        v-for="swatch in brands"
                        :key="swatch.key"
                        type="button"
                        class="h-8 w-8 rounded-full ring-offset-2 transition"
                        :class="[swatch.class, form.themeBrand === swatch.key ? 'ring-2 ring-gray-800' : 'hover:ring-2 hover:ring-gray-300']"
                        :aria-label="swatch.key"
                        :aria-pressed="form.themeBrand === swatch.key"
                        @click="form.themeBrand = swatch.key"
                    />
                </div>
                <p class="text-[11px] text-gray-400">{{ t('adminForm.basicThemeHint') }}</p>
            </div>

            <div class="flex justify-end border-t border-gray-100 pt-4">
                <button
                    class="rounded-lg bg-green-600 px-5 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50"
                    type="button"
                    :disabled="saving"
                    @click="save"
                >
                    {{ saving ? t('common.loading') : t('common.save') }}
                </button>
            </div>
        </div>
    </div>
</template>
