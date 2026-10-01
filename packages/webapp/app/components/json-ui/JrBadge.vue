<script setup lang="ts">
import { badgeTone } from '@commons/contract';
import { computed } from 'vue';

const props = withDefaults(
    defineProps<{
        label?: string | null;
        tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral' | null;
    }>(),
    { tone: 'neutral' },
);

const cls = computed(() => badgeTone(props.tone));
</script>

<template>
    <span :class="['app-badge my-0.5', cls]">{{ label }}</span>
</template>
