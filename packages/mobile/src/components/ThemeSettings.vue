<script setup lang="ts">
import { BRAND_PRESETS, MODE_PRESETS, presetText as localePresetText, type PresetItem } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import { useTheme } from '@/composables/useTheme';

const { mode, brand, setMode, setBrand } = useTheme();
const { t, locale } = useI18n();

/** 契约预置项的中英文选取规则收敛在契约的 presetText */
const presetText = (item: PresetItem) => localePresetText(item, locale.value);
</script>

<template>
    <div class="space-y-3">
        <!-- 深浅色 -->
        <div class="app-panel flex items-center justify-between p-3.5">
            <div>
                <p class="text-xs font-bold">{{ t('profile.appearanceMode') }}</p>
                <p class="text-faint mt-0.5 text-[11px]">{{ t('profile.appearanceModeHint') }}</p>
            </div>
            <div class="flex items-center gap-1">
                <button
                    v-for="option in MODE_PRESETS"
                    :key="option.value"
                    type="button"
                    class="rounded-lg px-2.5 py-1.5 text-sm transition-colors"
                    :class="mode === option.value ? 'bg-brand' : 'text-muted-2'"
                    :title="presetText(option)"
                    :aria-label="presetText(option)"
                    @click="setMode(option.value)"
                >
                    {{ option.icon }}
                </button>
            </div>
        </div>

        <!-- 四色主题 -->
        <div class="app-panel flex items-center justify-between p-3.5">
            <div>
                <p class="text-xs font-bold">{{ t('profile.brandColor') }}</p>
                <p class="text-faint mt-0.5 text-[11px]">{{ t('profile.brandColorHint') }}</p>
            </div>
            <div class="flex items-center gap-2">
                <button
                    v-for="preset in BRAND_PRESETS"
                    :key="preset.value"
                    type="button"
                    class="app-theme-dot"
                    :data-active="brand === preset.value"
                    :style="{ backgroundColor: preset.swatch }"
                    :title="presetText(preset)"
                    :aria-label="presetText(preset)"
                    @click="setBrand(preset.value)"
                />
            </div>
        </div>
    </div>
</template>
