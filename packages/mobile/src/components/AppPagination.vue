<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * 移动端分页脚注。附件 / 资讯 / 通知三个列表页的「上一页/下一页 + 页码」曾逐字重复三份
 * （含相同的 disabled 判定与 aria-label），收口成一个组件；触发翻页仍由调用方自己的 load() 处理。
 */
const props = defineProps<{
    page: number;
    totalPages: number;
}>();

const emit = defineEmits<{
    prev: [];
    next: [];
}>();

const { t } = useI18n();
</script>

<template>
    <div v-if="props.totalPages > 1" class="flex items-center justify-center gap-3 pt-2 text-xs">
        <button type="button" class="app-btn app-btn-outline !px-3 !py-1" :disabled="props.page <= 1" :aria-label="t('common.prevPage')" @click="emit('prev')">
            ‹
        </button>
        <span>{{ props.page }} / {{ props.totalPages }}</span>
        <button
            type="button"
            class="app-btn app-btn-outline !px-3 !py-1"
            :disabled="props.page >= props.totalPages"
            :aria-label="t('common.nextPage')"
            @click="emit('next')"
        >
            ›
        </button>
    </div>
</template>
