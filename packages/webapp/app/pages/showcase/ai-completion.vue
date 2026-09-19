<script setup lang="ts">
import { useCompletion } from '@ai-sdk/vue';

const { completion, input, handleSubmit } = useCompletion();
</script>

<template>
    <div class="mx-auto flex w-full max-w-md flex-col py-24">
        <h4 class="text-strong pb-4 text-xl font-bold md:text-xl">useCompletion Example</h4>
        {{ completion }}
        <form @submit="handleSubmit">
            <input class="app-input fixed bottom-0 mb-8 max-w-md" v-model="input" placeholder="Say something..." />
        </form>
    </div>
</template>
