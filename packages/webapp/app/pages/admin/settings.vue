<script setup lang="ts">
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

type TabKey = 'storage';
const tabs = computed<{ key: TabKey; label: string }[]>(() => [{ key: 'storage', label: t('nav.storage') }]);

/** 当前分区由 ?tab= 决定，便于深链到指定分区 */
const active = computed<TabKey>(() => 'storage');

function setTab(key: TabKey) {
    router.replace({ query: { ...route.query, tab: key } });
}
</script>

<template>
    <div class="space-y-6">
        <div>
            <h1 class="text-2xl font-bold text-gray-800">{{ t('settings.title') }}</h1>
            <p class="mt-1 text-xs text-gray-400">{{ t('settings.subtitle') }}</p>
        </div>

        <div class="flex gap-1 border-b border-gray-200">
            <button
                v-for="tab in tabs"
                :key="tab.key"
                type="button"
                class="-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors"
                :class="active === tab.key ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'"
                @click="setTab(tab.key)"
            >
                {{ tab.label }}
            </button>
        </div>

        <AdminSettingsStorage v-if="active === 'storage'" />
        <AdminSettingsProviders v-else />
    </div>
</template>
