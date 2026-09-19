<script setup lang="ts">
import { BRAND_PRESETS, MODE_PRESETS } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ middleware: 'auth' });

const { t, locale } = useI18n();
const { $setLocale } = useNuxtApp();
const { brand, mode, setBrand, setMode } = useTheme();

function handleLocaleChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    $setLocale(target.value as 'zh-CN' | 'en-US');
}
</script>

<template>
    <div class="app-card p-6">
        <h2 class="text-base font-black">{{ t('profile.preferences') }}</h2>
        <p class="text-faint mt-0.5 text-xs">{{ t('profile.preferencesHint') }}</p>

        <div class="mt-5 space-y-4">
            <!-- 深浅色 -->
            <div class="app-panel flex items-center justify-between p-4">
                <div>
                    <p class="text-xs font-bold">{{ t('profile.appearance') }}</p>
                    <p class="text-faint mt-0.5 text-[11px]">{{ t('profile.appearanceHint') }}</p>
                </div>
                <div class="flex items-center gap-1">
                    <button
                        v-for="option in MODE_PRESETS"
                        :key="option.value"
                        type="button"
                        class="rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors"
                        :class="mode === option.value ? 'bg-brand' : 'text-muted-2 text-hover-strong'"
                        :title="option.label"
                        @click="setMode(option.value)"
                    >
                        {{ option.icon }}
                    </button>
                </div>
            </div>

            <!-- 品牌色 -->
            <div class="app-panel flex items-center justify-between p-4">
                <div>
                    <p class="text-xs font-bold">{{ t('profile.themeColor') }}</p>
                    <p class="text-faint mt-0.5 text-[11px]">{{ t('profile.themeColorHint') }}</p>
                </div>
                <div class="flex items-center gap-2">
                    <button
                        v-for="preset in BRAND_PRESETS"
                        :key="preset.value"
                        type="button"
                        class="app-theme-dot"
                        :data-active="brand === preset.value"
                        :style="{ backgroundColor: preset.swatch }"
                        :title="preset.label"
                        @click="setBrand(preset.value)"
                    />
                </div>
            </div>

            <!-- 语言 -->
            <div class="app-panel flex items-center justify-between p-4">
                <div>
                    <p class="text-xs font-bold">{{ t('profile.languageSelect') }}</p>
                    <p class="text-faint mt-0.5 text-[11px]">{{ t('profile.languageOptions') }}</p>
                </div>
                <select :value="locale" class="app-input !w-auto !py-1.5 !text-xs font-bold" @change="handleLocaleChange">
                    <option value="zh-CN">简体中文</option>
                    <option value="en-US">English</option>
                </select>
            </div>
        </div>

        <div class="app-divider text-faint mt-6 flex items-center justify-between pt-4 text-xs">
            <span>ME Agent Platform</span>
            <span>v26.4.0</span>
        </div>
    </div>
</template>
