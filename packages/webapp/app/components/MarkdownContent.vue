<script setup lang="ts">
import { Markdown } from '@comark/vue';

/**
 * 内容页 Markdown 渲染（资讯正文 / 公告内容共用）。
 * 只启用基础 Markdown：资讯来自管理端，不启用 json-render 等生成式 UI 插件，
 * 避免运营内容意外触发聊天用的组件目录。
 */
defineProps<{ value: string }>();
</script>

<template>
    <Suspense>
        <Markdown :value="value || ''" class="markdown-body" />
        <template #fallback>
            <div class="whitespace-pre-wrap">{{ value }}</div>
        </template>
    </Suspense>
</template>
