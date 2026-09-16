<script setup lang="ts">
import { Markdown } from '@comark/vue';
import jsonRender from '@comark/vue/plugins/json-render';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { uiComponents } from '~/utils/json-ui';

const { t } = useI18n();

const props = defineProps<{ message: { id?: string; role: string; parts: any[] } }>();

const isUser = computed(() => props.message.role === 'user');
const reasoningExpanded = ref(false);
const copied = ref(false);

// json-render 插件：把 Markdown 中的 ```json-render 代码块渲染成生成式 UI 组件
const plugins = [jsonRender()];

type Segment = { kind: 'text'; value: string } | { kind: 'reasoning'; value: string } | { kind: 'tool'; value: string };

const segments = computed<Segment[]>(() => {
    const out: Segment[] = [];
    for (const part of props.message.parts ?? []) {
        if (part?.type === 'text') {
            if (part.text?.trim()) out.push({ kind: 'text', value: part.text });
        } else if (part?.type === 'reasoning') {
            const text = part.reasoning ?? part.text ?? '';
            if (text?.trim()) out.push({ kind: 'reasoning', value: text });
        } else if (typeof part?.type === 'string' && part.type.startsWith('tool-')) {
            const name = part.toolName || part.type.slice(5);
            const failed = part.state === 'output-error' || part.state === 'error';
            out.push({ kind: 'tool', value: failed ? `${name}（失败）` : name });
        }
    }
    return out;
});

const toolNames = computed(() => [...new Set(segments.value.filter((s) => s.kind === 'tool').map((s) => s.value))]);
const hasText = computed(() => segments.value.some((s) => s.kind === 'text'));

async function copyMessageText() {
    const texts = segments.value
        .filter((s): s is { kind: 'text'; value: string } => s.kind === 'text')
        .map((s) => s.value)
        .join('\n');
    if (!texts) return;
    try {
        await navigator.clipboard.writeText(texts);
        copied.value = true;
        setTimeout(() => (copied.value = false), 2000);
    } catch {
        // 剪贴板不可用时静默失败
    }
}
</script>

<template>
    <div :class="['group flex w-full items-start gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row']">
        <!-- 角色小头像 -->
        <div
            :class="[
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs shadow-2xs select-none',
                isUser ? 'bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200' : 'bg-surface-3 text-muted border-line border',
            ]"
        >
            {{ isUser ? '👤' : '🤖' }}
        </div>

        <div :class="['relative max-w-[85%] px-4 py-3 text-sm leading-relaxed', isUser ? 'app-bubble-user' : 'app-bubble-assistant']">
            <!-- 工具调用标记 -->
            <div v-if="!isUser && toolNames.length" class="mb-2.5 flex flex-wrap gap-1.5">
                <span v-for="name in toolNames" :key="name" class="app-chip !text-[10px]"> 🔧 {{ name }} </span>
            </div>

            <template v-for="(seg, i) in segments" :key="i">
                <!-- 思考过程 (Reasoning) -->
                <div
                    v-if="seg.kind === 'reasoning'"
                    class="my-1 mb-2.5 overflow-hidden rounded-xl border text-xs shadow-2xs backdrop-blur-xs transition-all"
                    style="border-color: color-mix(in oklab, var(--info) 30%, transparent); background-color: color-mix(in oklab, var(--info) 8%, transparent)"
                >
                    <button
                        type="button"
                        class="flex w-full items-center justify-between px-3 py-2 text-left font-medium select-none hover:opacity-90"
                        style="color: var(--info)"
                        @click="reasoningExpanded = !reasoningExpanded"
                    >
                        <div class="flex items-center gap-2">
                            <span class="text-sm">💭</span>
                            <span class="font-bold">{{ t('chat.reasoning') }}</span>
                            <span class="app-chip !py-0.5 !text-[9px]">Deep Thinking</span>
                        </div>
                        <span class="text-xs transition-transform duration-200" :class="{ 'rotate-180': reasoningExpanded }"> ▼ </span>
                    </button>
                    <div
                        v-show="reasoningExpanded"
                        class="text-soft max-h-60 overflow-y-auto px-3 py-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
                        style="border-top: 1px solid color-mix(in oklab, var(--info) 20%, transparent)"
                    >
                        {{ seg.value }}
                    </div>
                </div>

                <!-- 正文 (Markdown + json-render 生成式 UI) -->
                <Suspense v-else-if="seg.kind === 'text'">
                    <Markdown :value="seg.value as string" :plugins="plugins" :components="uiComponents" class="markdown-body" />
                    <template #fallback>
                        <span class="whitespace-pre-wrap">{{ seg.value }}</span>
                    </template>
                </Suspense>
            </template>

            <!-- 复制操作按钮（在消息上悬停展示） -->
            <button
                v-if="hasText"
                type="button"
                :class="[
                    'absolute -bottom-3 hidden items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium shadow-xs transition-all group-hover:flex',
                    isUser ? 'left-2' : 'right-2',
                    copied ? '!border-emerald-500 !bg-emerald-50 text-emerald-700 dark:!bg-emerald-950/80 dark:text-emerald-300' : '',
                ]"
                style="border-color: var(--line); background-color: var(--surface); color: var(--content-muted)"
                :title="t('common.copy')"
                @click="copyMessageText"
            >
                <span>{{ copied ? '✓' : '📋' }}</span>
                <span>{{ copied ? t('common.copied') : t('common.copy') }}</span>
            </button>

            <span v-if="!segments.length" class="text-faint">…</span>
        </div>
    </div>
</template>
