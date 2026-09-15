<script setup lang="ts">
defineProps<{
    title?: string | null;
    description?: string | null;
}>();
</script>

<template>
    <div class="app-card my-2.5 p-3.5">
        <div v-if="title" class="text-sm font-semibold">{{ title }}</div>
        <div v-if="description" class="text-muted-2 mt-0.5 text-xs">{{ description }}</div>
        <div class="mt-2">
            <slot />
        </div>
    </div>
</template>
