<script setup lang="ts">
import { Markdown } from '@comark/vue';
import jsonRender from '@comark/vue/plugins/json-render';
import { computed, ref } from 'vue';
import { uiComponents } from '~/utils/json-ui';

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
        setTimeout(() => (copied.value = false), 1800);
    } catch {
        // 剪贴板不可用时静默失败
    }
}
</script>

<template>
    <div :class="['group flex w-full', isUser ? 'justify-end' : 'justify-start']">
        <div :class="['relative max-w-[88%] px-4 py-2.5 text-sm', isUser ? 'app-bubble-user' : 'app-bubble-assistant']">
            <!-- 工具调用标记 -->
            <div v-if="!isUser && toolNames.length" class="mb-2 flex flex-wrap gap-1.5">
                <span v-for="name in toolNames" :key="name" class="app-chip text-[11px]"> 🔧 {{ name }} </span>
            </div>

            <template v-for="(seg, i) in segments" :key="i">
                <!-- 思考过程 (Reasoning) -->
                <div
                    v-if="seg.kind === 'reasoning'"
                    class="my-1 mb-2.5 overflow-hidden rounded-xl border text-xs"
                    style="border-color: color-mix(in oklab, var(--info) 30%, transparent); background-color: color-mix(in oklab, var(--info) 10%, transparent)"
                >
                    <button
                        type="button"
                        class="flex w-full items-center justify-between px-3 py-1.5 text-left font-medium"
                        style="color: var(--info)"
                        @click="reasoningExpanded = !reasoningExpanded"
                    >
                        <div class="flex items-center gap-1.5">
                            <span class="text-sm">💭</span>
                            <span>思考过程</span>
                            <span class="app-chip text-[10px]">深度思考</span>
                        </div>
                        <span class="text-xs transition-transform duration-200" :class="{ 'rotate-180': reasoningExpanded }"> ▼ </span>
                    </button>
                    <div
                        v-show="reasoningExpanded"
                        class="text-soft max-h-60 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
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

            <!-- 复制操作按钮（在 assistant 消息上悬停展示） -->
            <button
                v-if="!isUser && hasText"
                type="button"
                class="absolute right-2 -bottom-3 hidden items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] shadow-xs transition-all group-hover:flex"
                style="border-color: var(--line); background-color: var(--surface); color: var(--content-muted)"
                title="复制消息内容"
                @click="copyMessageText"
            >
                <span>{{ copied ? '已复制 ✓' : '复制' }}</span>
            </button>

            <span v-if="!segments.length" class="text-faint">…</span>
        </div>
    </div>
</template>
