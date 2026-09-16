<script setup lang="ts">
import { BRAND_PRESETS, MODE_PRESETS } from '@contract';
import { useTheme } from '../composables/useTheme';

const { mode, brand, setMode, setBrand } = useTheme();
</script>

<template>
    <div class="space-y-3">
        <!-- 深浅色 -->
        <div class="app-panel flex items-center justify-between p-3.5">
            <div>
                <p class="text-xs font-bold">外观模式</p>
                <p class="text-faint mt-0.5 text-[11px]">浅色 / 深色 / 跟随系统</p>
            </div>
            <div class="flex items-center gap-1">
                <button
                    v-for="option in MODE_PRESETS"
                    :key="option.value"
                    type="button"
                    class="rounded-lg px-2.5 py-1.5 text-sm transition-colors"
                    :class="mode === option.value ? 'bg-brand' : 'text-muted-2'"
                    :title="option.label"
                    @click="setMode(option.value)"
                >
                    {{ option.icon }}
                </button>
            </div>
        </div>

        <!-- 四色主题 -->
        <div class="app-panel flex items-center justify-between p-3.5">
            <div>
                <p class="text-xs font-bold">主题配色</p>
                <p class="text-faint mt-0.5 text-[11px]">蓝色 / 绿色 / 黄色 / 红色</p>
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
    </div>
</template>
