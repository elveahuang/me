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
    <div class="stretch mx-auto flex w-full max-w-md flex-col py-24">
        <div v-for="m in chat.messages" :key="m.id" class="whitespace-pre-wrap">
            {{ m.role === 'user' ? 'User: ' : 'AI: ' }}
            {{ m.parts.map((part) => (part.type === 'text' ? part.text : '')).join('') }}
        </div>

        <div v-if="chat.status === 'submitted' || chat.status === 'streaming'" class="mt-4 text-gray-500">
            <div v-if="chat.status === 'submitted'">Loading...</div>
            <button type="button" class="mt-4 rounded-md border border-blue-500 px-4 py-2 text-blue-500" @click="chat.stop">Stop</button>
        </div>

        <div v-if="chat.error" class="mt-4">
            <div class="text-red-500">An error occurred.</div>
            <button type="button" class="mt-4 rounded-md border border-blue-500 px-4 py-2 text-blue-500" @click="() => chat.regenerate()">Retry</button>
        </div>

        <form @submit="handleSubmit">
            <input
                class="fixed bottom-0 mb-8 w-full max-w-md rounded border border-gray-300 p-2 shadow-xl"
                v-model="input"
                placeholder="Say something..."
                :disabled="disabled"
            />
        </form>
    </div>
</template>
