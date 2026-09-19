<script setup lang="ts">
import { formatDate, type BulletinRecord } from '@commons/contract';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/auth';

/**
 * 宣传栏（移动端）。位置语义与服务端一致：global 全站可见，home/chat 各自命中。
 * 关闭状态存 localStorage，避免同一设备反复弹出已读内容。
 */
const props = withDefaults(defineProps<{ position: 'home' | 'chat' | 'global' }>(), { position: 'home' });

const { t } = useI18n();

const bulletins = ref<BulletinRecord[]>([]);
const dismissed = ref<string[]>([]);

/** 与 Web 端 BulletinBanner 同一套 app-alert 级别类：色块由主题令牌给出，深色模式才不会读不出来 */
const levelClass: Record<string, string> = {
    info: 'app-alert-info',
    success: 'app-alert-success',
    warning: 'app-alert-warning',
    danger: 'app-alert-danger',
};

async function load() {
    try {
        const res = await api<{ bulletins: BulletinRecord[] }>(`/api/bulletins?position=${props.position}`);
        bulletins.value = res.bulletins;
    } catch {
        // 宣传栏是辅助内容，失败静默
    }
}

onMounted(() => {
    try {
        dismissed.value = JSON.parse(localStorage.getItem('mobile_dismissed_bulletins') || '[]');
    } catch {
        dismissed.value = [];
    }
    void load();
});

const visible = computed(() => bulletins.value.filter((item) => !dismissed.value.includes(item.id)));

function dismiss(id: string) {
    dismissed.value.push(id);
    try {
        localStorage.setItem('mobile_dismissed_bulletins', JSON.stringify(dismissed.value.slice(-50)));
    } catch {
        // 存储不可用时忽略
    }
}
</script>

<template>
    <div v-if="visible.length" class="space-y-2 px-4 pt-3">
        <div v-for="item in visible" :key="item.id" :class="['app-alert flex items-start gap-2', levelClass[item.level] ?? levelClass.info]">
            <img v-if="item.imageUrl" :src="item.imageUrl" :alt="item.title" class="h-10 w-10 shrink-0 rounded-lg object-cover" />
            <div class="min-w-0 flex-1">
                <p class="text-[11px] font-bold">{{ item.title }}</p>
                <p v-if="item.content" class="text-muted-2 mt-0.5 line-clamp-2 text-[10px] leading-relaxed">{{ item.content }}</p>
                <div class="mt-1.5 flex items-center gap-2">
                    <a v-if="item.linkUrl" :href="item.linkUrl" class="app-link text-[10px] underline" target="_blank" rel="noopener">
                        {{ item.linkText || t('common.viewDetail') }}
                    </a>
                    <span v-if="item.endsAt" class="text-faint text-[9px]">{{ t('common.endsAt', { date: formatDate(item.endsAt) }) }}</span>
                </div>
            </div>
            <button type="button" class="text-faint shrink-0 p-0.5 text-xs leading-none" @click="dismiss(item.id)">✕</button>
        </div>
    </div>
</template>
