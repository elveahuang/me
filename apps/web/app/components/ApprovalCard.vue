<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
    approval: {
        id: string;
        toolName: string;
        risk: string;
        payload?: Record<string, unknown> | null;
        createdAt?: string;
    };
}>();
const emit = defineEmits<{ decided: [id: string, decision: 'allow' | 'deny'] }>();
const { t } = useI18n();
const busy = ref(false);
const error = ref('');

const payloadText = computed(() => {
    try {
        return JSON.stringify(props.approval.payload ?? {}, null, 2).slice(0, 2000);
    } catch {
        return '';
    }
});

async function decide(decision: 'allow' | 'deny') {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
        await $fetch(`/api/approvals/${encodeURIComponent(props.approval.id)}/decide`, {
            method: 'POST',
            body: { decision },
        });
        emit('decided', props.approval.id, decision);
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        busy.value = false;
    }
}

function onKeydown(event: KeyboardEvent) {
    if (busy.value) return;
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void decide('allow');
    } else if (event.key === 'Escape') {
        event.preventDefault();
        void decide('deny');
    }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
    <div class="app-card mb-3 border-l-4 border-l-amber-500 !p-3" role="alertdialog" aria-live="assertive">
        <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
                <div class="text-sm font-medium">⚠️ {{ t('chat.approvalTitle') }}</div>
                <div class="text-faint mt-1 text-xs">
                    {{ t('chat.approvalTool', { name: approval.toolName, risk: approval.risk }) }}
                </div>
            </div>
            <span class="app-chip !py-0.5 text-[10px] uppercase">{{ approval.risk }}</span>
        </div>
        <pre v-if="payloadText" class="app-code mt-2 max-h-32 overflow-auto !text-[11px] whitespace-pre-wrap">{{ payloadText }}</pre>
        <div v-if="error" class="app-alert app-alert-danger mt-2 !text-[11px]">{{ error }}</div>
        <div class="mt-3 flex items-center gap-2">
            <button type="button" class="app-btn app-btn-primary !py-1.5" :disabled="busy" @click="decide('allow')">
                {{ t('chat.approvalAllow') }}
            </button>
            <button type="button" class="app-btn app-btn-outline !py-1.5" :disabled="busy" @click="decide('deny')">
                {{ t('chat.approvalDeny') }}
            </button>
            <span class="text-faint ml-auto text-[10px]">{{ t('chat.approvalShortcut') }}</span>
        </div>
    </div>
</template>
