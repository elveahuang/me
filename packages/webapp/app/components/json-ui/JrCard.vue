<script setup lang="ts">
defineProps<{
    title?: string | null;
    description?: string | null;
}>();
</script>

<template>
    <div class="app-card my-3 p-4">
        <div v-if="title" class="text-base font-semibold">{{ title }}</div>
        <div v-if="description" class="text-muted-2 mt-0.5 text-sm">{{ description }}</div>
        <div class="mt-2">
            <slot />
        </div>
    </div>
</template>
