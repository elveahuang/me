<script setup lang="ts">
import { Markdown } from '@comark/vue';

/**
 * 内容页 Markdown 渲染（资讯正文 / 公告内容共用）。
 * 只启用基础 Markdown：资讯来自管理端，不启用 json-render 等生成式 UI 插件，
 * 避免运营内容意外触发聊天用的组件目录。
 */
defineProps<{ value: string }>();

// 根节点是 <Suspense>，Vue 无法自动把调用方传的 `class` 落到任何一个分支上：
// 少这一行时 `<MarkdownContent class="mt-3">` 的间距会静默丢掉，并在控制台每次渲染刷一条警告。
defineOptions({ inheritAttrs: false });
</script>

<template>
    <Suspense>
        <Markdown v-bind="$attrs" :value="value || ''" class="markdown-body" />
        <template #fallback>
            <div v-bind="$attrs" class="whitespace-pre-wrap">{{ value }}</div>
        </template>
    </Suspense>
</template>
