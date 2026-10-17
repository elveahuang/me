<script setup lang="ts">
import { useI18n } from 'vue-i18n';

withDefaults(
    defineProps<{
        agentId?: string | null;
        agentEmoji: string;
        agentName: string;
        description?: string;
        starterPrompts?: string[];
        switchable?: boolean;
    }>(),
    { agentId: null, description: '', starterPrompts: () => [], switchable: false },
);

const emit = defineEmits<{
    'open-agent-picker': [];
    send: [prompt: string];
    fill: [prompt: string];
}>();

const { t } = useI18n();
</script>

<template>
    <div class="flex h-full flex-col items-center justify-center py-10 text-center">
        <template v-if="!agentId">
            <div class="app-avatar-icon h-16 w-16 !rounded-3xl text-3xl">🤖</div>
            <h3 class="mt-3 text-base font-bold">{{ t('chat.pickAgentTitle') }}</h3>
            <p class="text-faint mt-1 max-w-sm text-xs">{{ t('chat.pickAgentDesc') }}</p>
            <button v-if="switchable" type="button" class="app-btn app-btn-primary mt-5" @click="emit('open-agent-picker')">
                {{ t('chat.selectAgent') }}
            </button>
        </template>
        <template v-else>
            <div class="app-avatar-icon h-16 w-16 !rounded-3xl text-3xl">{{ agentEmoji }}</div>
            <h3 class="mt-3 text-base font-bold">{{ t('chat.welcomeTitle') }} · {{ agentName }}</h3>
            <p class="text-faint mt-1 max-w-sm text-xs">{{ description || t('chat.welcomeDesc') }}</p>

            <div class="mt-6 flex w-full max-w-md flex-col gap-2.5">
                <div
                    v-for="prompt in starterPrompts"
                    :key="prompt"
                    class="app-card app-card-hover group flex items-center justify-between px-4 py-3 text-left text-xs transition-all"
                >
                    <button type="button" class="text-soft flex-1 text-left" @click="emit('send', prompt)">{{ prompt }}</button>
                    <button
                        type="button"
                        class="app-hover-reveal text-faint text-hover-brand ml-2 block shrink-0 rounded p-1 text-xs"
                        :title="t('chat.usePrompt')"
                        :aria-label="t('chat.usePrompt')"
                        @click="emit('fill', prompt)"
                    >
                        ✏️
                    </button>
                </div>
            </div>
        </template>
    </div>
</template>
