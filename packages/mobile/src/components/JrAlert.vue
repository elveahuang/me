<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
    defineProps<{
        message?: string | null;
        level?: 'info' | 'success' | 'warning' | 'danger' | null;
    }>(),
    { level: 'info' },
);

const levelClasses: Record<string, string> = {
    info: 'app-alert-info',
    success: 'app-alert-success',
    warning: 'app-alert-warning',
    danger: 'app-alert-danger',
};

const cls = computed(() => levelClasses[props.level ?? 'info'] ?? levelClasses.info);
</script>

<template>
    <div :class="['app-alert my-2.5', cls]" role="alert">{{ message }}</div>
</template>
