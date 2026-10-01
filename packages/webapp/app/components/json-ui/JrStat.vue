<script setup lang="ts">
defineProps<{
    label?: string | null;
    value?: string | null;
    hint?: string | null;
}>();
</script>

<template>
    <div class="app-card my-3 inline-flex min-w-36 flex-col px-4 py-3">
        <span class="text-muted-2 text-xs font-medium">{{ label }}</span>
        <span class="text-brand mt-1 text-2xl font-bold tabular-nums">{{ value }}</span>
        <span v-if="hint" class="text-faint mt-0.5 text-xs">{{ hint }}</span>
    </div>
</template>
