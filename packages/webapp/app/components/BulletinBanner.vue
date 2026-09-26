<script setup lang="ts">
import { formatDate, type BulletinListResponse, type BulletinRecord } from '@commons/contract';
import { useI18n } from 'vue-i18n';

/**
 * 宣传栏（用户端横幅）。
 * position 决定展示位置：home 首页 / chat 对话页 / global 全站。
 * 时间窗与启用状态由服务端过滤，这里只负责渲染。
 */
const props = withDefaults(defineProps<{ position: 'home' | 'chat' | 'global' }>(), { position: 'home' });

const { t } = useI18n();
const bulletins = ref<BulletinRecord[]>([]);
const dismissed = ref<string[]>([]);

const levelClass: Record<string, string> = {
    info: 'app-alert-info',
    success: 'app-alert-success',
    warning: 'app-alert-warning',
    danger: 'app-alert-danger',
};

async function load() {
    try {
        const res = await $fetch<BulletinListResponse>('/api/bulletins', { query: { position: props.position } });
        bulletins.value = res.bulletins;
    } catch {
        // 宣传栏是辅助信息，加载失败静默降级为空，不阻塞主内容也不弹全局错误
    }
}

onMounted(() => {
    try {
        // localStorage 里可能是任何 JSON（旧版本/手工改动），只有字符串数组才可用
        const raw = JSON.parse(localStorage.getItem('ee_dismissed_bulletins') || '[]');
        dismissed.value = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch {
        dismissed.value = [];
    }
    void load();
});

const visible = computed(() => bulletins.value.filter((item) => !dismissed.value.includes(item.id)));

function dismiss(id: string) {
    dismissed.value.push(id);
    try {
        // 只保留最近 50 条，避免 localStorage 无限增长
        localStorage.setItem('ee_dismissed_bulletins', JSON.stringify(dismissed.value.slice(-50)));
    } catch {
        // 隐私模式下 localStorage 可能不可用，忽略
    }
}
</script>

<template>
    <div v-if="visible.length" class="space-y-2">
        <div v-for="item in visible" :key="item.id" :class="['app-alert', levelClass[item.level] ?? 'app-alert-info']">
            <img v-if="item.imageUrl" :src="item.imageUrl" :alt="item.title" class="h-10 w-10 shrink-0 rounded-lg object-cover" />
            <div class="min-w-0 flex-1">
                <p class="text-xs font-bold">{{ item.title }}</p>
                <p v-if="item.content" class="mt-0.5 text-[11px] leading-relaxed opacity-90">{{ item.content }}</p>
                <p v-if="item.endsAt" class="mt-1 text-[10px] opacity-70">{{ t('common.endsAt', { date: formatDate(item.endsAt) }) }}</p>
            </div>
            <a v-if="item.linkUrl" :href="item.linkUrl" class="app-btn app-btn-soft shrink-0 !px-3 !py-1 !text-[11px]" target="_blank" rel="noopener">
                {{ item.linkText || t('common.more') }}
            </a>
            <!-- -m 抵消 padding 的占位，只扩大触摸热区（icon 14px 裸放小于任何触控标准） -->
            <button
                type="button"
                class="-m-1.5 shrink-0 p-1.5 opacity-60 transition-opacity hover:opacity-100"
                :aria-label="t('common.close')"
                @click="dismiss(item.id)"
            >
                <AppIcon name="close" :size="14" />
            </button>
        </div>
    </div>
</template>
