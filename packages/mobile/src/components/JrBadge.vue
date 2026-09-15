<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
    defineProps<{
        label?: string | null;
        tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral' | null;
    }>(),
    { tone: 'neutral' },
);

const toneClasses: Record<string, string> = {
    info: 'app-badge-info',
    success: 'app-badge-success',
    warning: 'app-badge-warning',
    danger: 'app-badge-danger',
    neutral: 'app-badge-neutral',
};

const cls = computed(() => toneClasses[props.tone ?? 'neutral'] ?? toneClasses.neutral);
</script>

<template>
    <span :class="['app-badge my-0.5', cls]">{{ label }}</span>
</template>
