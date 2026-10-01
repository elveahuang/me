<script setup lang="ts">
import { Markdown } from '@comark/vue';

/**
 * 移动端内容页 Markdown 渲染（资讯正文）。
 * 不启用 json-render 插件：运营内容不需要生成式 UI，保持渲染可控。
 */
defineProps<{ value: string }>();
</script>

<template>
    <Suspense>
        <Markdown :value="value || ''" class="markdown-body text-[12px]" />
        <template #fallback>
            <div class="text-[12px] whitespace-pre-wrap">{{ value }}</div>
        </template>
    </Suspense>
</template>
