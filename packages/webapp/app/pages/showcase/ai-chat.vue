<script setup lang="ts">
import { Chat } from '@ai-sdk/vue';
import { computed, ref } from 'vue';

const chat = new Chat({});
const input = ref('');
const disabled = computed(() => chat.status !== 'ready');
const handleSubmit = (e: Event) => {
    e.preventDefault();
    chat.sendMessage({ text: input.value });
    input.value = '';
};
</script>

<template>
    <div class="mx-auto flex w-full max-w-md flex-col py-24">
        <div v-for="m in chat.messages" :key="m.id" class="whitespace-pre-wrap">
            {{ m.role === 'user' ? 'User: ' : 'AI: ' }}
            {{ m.parts.map((part) => (part.type === 'text' ? part.text : '')).join('') }}
        </div>

        <div v-if="chat.status === 'submitted' || chat.status === 'streaming'" class="text-muted-2 mt-4">
            <div v-if="chat.status === 'submitted'">Loading...</div>
            <button type="button" class="app-btn app-btn-outline mt-4" @click="chat.stop">Stop</button>
        </div>

        <div v-if="chat.error" class="mt-4">
            <p class="app-help-error">An error occurred.</p>
            <button type="button" class="app-btn app-btn-outline mt-4" @click="() => chat.regenerate()">Retry</button>
        </div>

        <form @submit="handleSubmit">
            <input class="app-input fixed bottom-0 mb-8 max-w-md" v-model="input" placeholder="Say something..." :disabled="disabled" />
        </form>
    </div>
</template>
