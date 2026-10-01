<template>
    <Suspense>
        <Markdown :value="content" />
    </Suspense>
</template>

<script setup lang="ts">
import { Markdown } from '@comark/vue';

const content = `# Hello World

This is **markdown** with Comark components.
`;
</script>
