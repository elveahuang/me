<script setup lang="ts">
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

type TabKey = 'basic' | 'storage';
const tabs = computed<{ key: TabKey; label: string }[]>(() => [
    { key: 'basic', label: t('nav.basic') },
    { key: 'storage', label: t('nav.storage') },
]);

/** 当前分区由 ?tab= 决定，便于深链到指定分区；默认基础设置 */
const active = computed<TabKey>(() => (route.query.tab === 'storage' ? 'storage' : 'basic'));

function setTab(key: TabKey) {
    router.replace({ query: { ...route.query, tab: key } });
}
</script>

<template>
    <div class="space-y-6">
        <div>
            <h1 class="app-page-title text-strong">{{ t('settings.title') }}</h1>
            <p class="app-page-subtitle">{{ t('settings.subtitle') }}</p>
        </div>

        <div class="app-segmented">
            <button v-for="tab in tabs" :key="tab.key" type="button" class="app-segmented-item" :aria-pressed="active === tab.key" @click="setTab(tab.key)">
                {{ tab.label }}
            </button>
        </div>

        <AdminSettingsBasic v-if="active === 'basic'" />
        <AdminSettingsStorage v-else />
    </div>
</template>
