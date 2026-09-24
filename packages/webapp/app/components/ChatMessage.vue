<script setup lang="ts">
import { Markdown } from '@comark/vue';
import jsonRender from '@comark/vue/plugins/json-render';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { uiComponents } from '~/utils/json-ui';

const { t } = useI18n();

const props = defineProps<{ message: { id?: string; role: string; parts: any[] } }>();

const isUser = computed(() => props.message.role === 'user');
const reasoningExpanded = ref(false);
const copied = ref(false);
const copyFailed = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

// json-render 插件：把 Markdown 中的 ```json-render 代码块渲染成生成式 UI 组件
const plugins = [jsonRender()];

type Segment =
    | { kind: 'text'; value: string }
    | { kind: 'reasoning'; value: string }
    | { kind: 'tool'; value: string }
    | { kind: 'file'; value: string; url: string; mediaType: string; isImage: boolean };

const asText = (v: unknown) => (typeof v === 'string' ? v : '');

const segments = computed<Segment[]>(() => {
    const out: Segment[] = [];
    for (const part of props.message.parts ?? []) {
        if (part?.type === 'text') {
            const text = asText(part.text);
            if (text.trim()) out.push({ kind: 'text', value: text });
        } else if (part?.type === 'reasoning') {
            const text = asText(part.reasoning) || asText(part.text);
            if (text.trim()) out.push({ kind: 'reasoning', value: text });
        } else if (part?.type === 'file' || part?.type === 'image') {
            // 用户发送的附件：历史里存的是稳定地址（公开桶公网地址或站内下载路径）。
            // 此前不处理 file/image，附件消息会渲染成空白。
            const url = typeof part.url === 'string' ? part.url : '';
            if (!url) continue;
            const mediaType = typeof part.mediaType === 'string' ? part.mediaType : 'application/octet-stream';
            out.push({
                kind: 'file',
                value: typeof part.filename === 'string' && part.filename ? part.filename : t('chat.attachedFile'),
                url,
                mediaType,
                isImage: mediaType.startsWith('image/'),
            });
        } else if (typeof part?.type === 'string' && part.type.startsWith('tool-')) {
            const name = part.toolName || part.type.slice(5);
            const failed = part.state === 'output-error' || part.state === 'error';
            out.push({ kind: 'tool', value: failed ? t('chat.toolFailed', { name }) : name });
        }
    }
    return out;
});

const toolNames = computed(() => [...new Set(segments.value.filter((s) => s.kind === 'tool').map((s) => s.value))]);
const hasText = computed(() => segments.value.some((s) => s.kind === 'text'));
/** 仅有附件、没有文字时也要渲染消息体与操作栏 */
const fileSegments = computed(() => segments.value.filter((s): s is Extract<Segment, { kind: 'file' }> => s.kind === 'file'));

const imagePreview = ref('');
/**
 * 预览层的行为收敛到 useDrawerFocus：它自带 Esc 关闭，还补上了这里原来没有的
 * Tab 圈闭、body 滚动锁与关闭后焦点归还（原来焦点会留在已被隐藏的缩略图上）。
 */
const previewPanel = ref<HTMLElement | null>(null);
useDrawerFocus(
    () => !!imagePreview.value,
    previewPanel,
    () => {
        imagePreview.value = '';
    },
);

/** 复制结果的短暂反馈：成功与失败共用一个定时器，2 秒后各自复位 */
function flashCopy(ok: boolean) {
    copied.value = ok;
    copyFailed.value = !ok;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
        copied.value = false;
        copyFailed.value = false;
    }, 2000);
}

async function copyMessageText() {
    const texts = segments.value
        .filter((s): s is { kind: 'text'; value: string } => s.kind === 'text')
        .map((s) => s.value)
        .join('\n');
    if (!texts) return;
    try {
        await navigator.clipboard.writeText(texts);
        flashCopy(true);
    } catch {
        // 剪贴板在非安全上下文或被拒权限下会直接 reject（https 之外的域名、部分内网部署）。
        // 静默吞掉的界面表现是「点了完全没反应」，用户只会反复点，所以失败也要回一声。
        flashCopy(false);
    }
}

// 组件卸载（如切换会话/清空记录）时清理，避免定时器在销毁后回写已失效状态
onBeforeUnmount(() => {
    if (copiedTimer) clearTimeout(copiedTimer);
});
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

                <!-- 用户发送的附件：图片内联可点开大图，其他文件提供下载入口 -->
                <div v-else-if="seg.kind === 'file'" class="my-1.5 flex flex-wrap gap-2">
                    <button
                        v-if="seg.isImage"
                        type="button"
                        class="overflow-hidden rounded-xl border"
                        style="border-color: var(--line); max-width: 16rem"
                        :title="seg.value"
                        @click="imagePreview = seg.url"
                    >
                        <img :src="seg.url" :alt="seg.value" class="max-h-48 object-cover" />
                    </button>
                    <a
                        v-else
                        :href="seg.url"
                        target="_blank"
                        rel="noopener"
                        class="app-chip max-w-[16rem] !py-1.5 hover:opacity-90"
                        :title="seg.value"
                        download
                    >
                        <AppIcon name="file-outline" :size="14" />
                        <span class="truncate">{{ seg.value }}</span>
                        <span class="text-faint text-[10px]">{{ t('chat.downloadFile') }}</span>
                    </a>
                </div>
            </template>

            <!-- 复制操作按钮（在消息上悬停展示） -->
            <button
                v-if="hasText"
                type="button"
                :class="[
                    'app-hover-reveal absolute -bottom-3 flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium shadow-xs transition-all',
                    isUser ? 'left-2' : 'right-2',
                ]"
                :style="
                    copied
                        ? { borderColor: 'var(--success)', backgroundColor: 'var(--surface)', color: 'var(--success)' }
                        : copyFailed
                          ? { borderColor: 'var(--danger)', backgroundColor: 'var(--surface)', color: 'var(--danger)' }
                          : { borderColor: 'var(--line)', backgroundColor: 'var(--surface)', color: 'var(--content-muted)' }
                "
                :title="copyFailed ? t('common.copyFailed') : t('common.copy')"
                @click="copyMessageText"
            >
                <span>{{ copied ? '✓' : copyFailed ? '!' : '📋' }}</span>
                <span>{{ copied ? t('common.copied') : copyFailed ? t('common.copyFailed') : t('common.copy') }}</span>
            </button>

            <span v-if="!segments.length" class="text-faint">…</span>
        </div>

        <!-- 附件图片大图预览 -->
        <Teleport to="body">
            <div
                v-if="imagePreview"
                ref="previewPanel"
                class="app-modal-backdrop"
                role="dialog"
                aria-modal="true"
                :aria-label="t('chat.imagePreview')"
                @click.self="imagePreview = ''"
            >
                <img :src="imagePreview" :alt="t('chat.imagePreview')" class="max-h-[85vh] max-w-[90vw] rounded-xl object-contain" />
                <button type="button" class="app-btn app-btn-soft absolute top-4 right-4" :aria-label="t('common.close')" @click="imagePreview = ''">
                    <AppIcon name="close" :size="16" />
                </button>
            </div>
        </Teleport>
    </div>
</template>
