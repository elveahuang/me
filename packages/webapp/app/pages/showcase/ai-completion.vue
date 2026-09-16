<script setup lang="ts">
import { useCompletion } from '@ai-sdk/vue';

const { completion, input, handleSubmit } = useCompletion();
</script>

<template>
    <div class="stretch mx-auto flex w-full max-w-md flex-col py-24">
        <h4 class="pb-4 text-xl font-bold text-gray-900 md:text-xl">useCompletion Example</h4>
        {{ completion }}
        <form @submit="handleSubmit">
            <input class="fixed bottom-0 mb-8 w-full max-w-md rounded border border-gray-300 p-2 shadow-xl" v-model="input" placeholder="Say something..." />
        </form>
    </div>
</template>
