<script setup lang="ts">
import { BRAND_PRESETS, MODE_PRESETS } from '@commons/contract';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * 外观设置面板：深浅色三段控件 + 四色品牌圆点。
 * panel：完整面板（头部下拉浮层 / 移动端抽屉内使用）
 * compact：仅一行图标按钮（空间紧张的工具栏）
 */
const props = withDefaults(defineProps<{ variant?: 'panel' | 'compact' }>(), { variant: 'panel' });

const { t, locale } = useI18n();
const { brand, mode, setBrand, setMode } = useTheme();

/** 模式图标：与 MODE_PRESETS 的取值一一对应 */
const MODE_ICONS: Record<string, string> = {
    light: 'white-balance-sunny',
    dark: 'moon-waning-crescent',
    system: 'monitor',
};

const isEnglish = computed(() => locale.value === 'en-US');

const modes = computed(() =>
    MODE_PRESETS.map((preset) => ({
        ...preset,
        text: isEnglish.value ? preset.labelEn : preset.label,
        icon: MODE_ICONS[preset.value] ?? 'monitor',
    })),
);

const brandLabel = (preset: (typeof BRAND_PRESETS)[number]) => (isEnglish.value ? preset.labelEn : preset.label);
</script>

<template>
    <!-- 紧凑模式：只显示模式图标，空间受限的工具栏使用 -->
    <div v-if="props.variant === 'compact'" class="flex items-center gap-1">
        <button
            v-for="preset in modes"
            :key="preset.value"
            type="button"
            class="app-btn app-btn-icon app-btn-sm"
            :class="mode === preset.value ? 'app-btn-soft' : 'app-btn-ghost'"
            :title="preset.text"
            :aria-label="preset.text"
            :aria-pressed="mode === preset.value"
            @click="setMode(preset.value)"
        >
            <AppIcon :name="preset.icon" :size="16" />
        </button>
    </div>

    <div v-else class="space-y-3">
        <div>
            <p class="app-dropdown-label !px-0">{{ t('common.theme') }}</p>
            <div class="app-segmented w-full">
                <button
                    v-for="preset in modes"
                    :key="preset.value"
                    type="button"
                    class="app-segmented-item flex flex-1 items-center justify-center gap-1.5"
                    :aria-pressed="mode === preset.value"
                    @click="setMode(preset.value)"
                >
                    <AppIcon :name="preset.icon" :size="15" />
                    <span>{{ preset.text }}</span>
                </button>
            </div>
        </div>

        <div>
            <p class="app-dropdown-label !px-0">{{ t('profile.themeColor') }}</p>
            <div class="flex items-center gap-2 px-1 py-1">
                <button
                    v-for="preset in BRAND_PRESETS"
                    :key="preset.value"
                    type="button"
                    class="app-theme-dot"
                    :data-active="brand === preset.value"
                    :style="{ backgroundColor: preset.swatch }"
                    :title="brandLabel(preset)"
                    :aria-label="brandLabel(preset)"
                    :aria-pressed="brand === preset.value"
                    @click="setBrand(preset.value)"
                />
            </div>
        </div>
    </div>
</template>
