<script setup lang="ts">
import { BRAND_PRESETS, MODE_PRESETS } from '@commons/contract';

withDefaults(
    defineProps<{
        /** compact：仅展示图标按钮，用于移动端头部；full：带文字标签 */
        variant?: 'compact' | 'full';
    }>(),
    { variant: 'compact' },
);

const { brand, mode, setBrand, setMode } = useTheme();
</script>

<template>
    <div class="flex items-center gap-1.5" :class="variant === 'full' ? 'flex-wrap' : ''">
        <!-- 浅色 / 深色 / 跟随系统 -->
        <div class="app-panel flex items-center gap-0.5 p-1">
            <button
                v-for="option in MODE_PRESETS"
                :key="option.value"
                type="button"
                class="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors"
                :class="mode === option.value ? 'bg-brand text-[color:var(--on-brand)]' : 'text-muted-2 hover:text-strong'"
                :title="option.label"
                :aria-label="option.label"
                :aria-pressed="mode === option.value"
                @click="setMode(option.value)"
            >
                <span>{{ option.icon }}</span>
                <span v-if="variant === 'full'">{{ option.label }}</span>
            </button>
        </div>

        <!-- 四色主题 -->
        <div class="app-panel flex items-center gap-1.5 px-2 py-1.5">
            <button
                v-for="preset in BRAND_PRESETS"
                :key="preset.value"
                type="button"
                class="app-theme-dot"
                :data-active="brand === preset.value"
                :style="{ backgroundColor: preset.swatch }"
                :title="preset.label"
                :aria-label="preset.label"
                :aria-pressed="brand === preset.value"
                @click="setBrand(preset.value)"
            />
        </div>
    </div>
</template>
