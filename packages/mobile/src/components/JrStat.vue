<script setup lang="ts">
defineProps<{
    label?: string | null;
    value?: string | null;
    hint?: string | null;
}>();
</script>

<template>
    <div class="app-card my-2.5 inline-flex min-w-32 flex-col px-3.5 py-2.5">
        <span class="text-muted-2 text-[11px] font-medium">{{ label }}</span>
        <span class="text-brand mt-1 text-xl font-bold tabular-nums">{{ value }}</span>
        <span v-if="hint" class="text-faint mt-0.5 text-[11px]">{{ hint }}</span>
    </div>
</template>
