<script setup lang="ts">
import { formatDate, type BulletinRecord } from '@commons/contract';
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/auth';

/**
 * 宣传栏（移动端）。位置语义与服务端一致：global 全站可见，home/chat 各自命中。
 * 关闭状态存 localStorage，避免同一设备反复弹出已读内容。
 */
const props = withDefaults(defineProps<{ position: 'home' | 'chat' | 'global' }>(), { position: 'home' });

const bulletins = ref<BulletinRecord[]>([]);
const dismissed = ref<string[]>([]);

const levelBg: Record<string, string> = {
    info: 'border-[color:var(--brand-400)] bg-[color:var(--brand-50)]',
    success: 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40',
    warning: 'border-amber-300 bg-amber-50 dark:bg-amber-950/40',
    danger: 'border-red-300 bg-red-50 dark:bg-red-950/40',
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
        <div v-for="item in visible" :key="item.id" :class="['flex items-start gap-2 rounded-xl border p-3', levelBg[item.level] ?? levelBg.info]">
            <img v-if="item.imageUrl" :src="item.imageUrl" :alt="item.title" class="h-10 w-10 shrink-0 rounded-lg object-cover" />
            <div class="min-w-0 flex-1">
                <p class="text-[11px] font-bold">{{ item.title }}</p>
                <p v-if="item.content" class="text-muted-2 mt-0.5 line-clamp-2 text-[10px] leading-relaxed">{{ item.content }}</p>
                <div class="mt-1.5 flex items-center gap-2">
                    <a v-if="item.linkUrl" :href="item.linkUrl" class="text-primary-600 text-[10px] font-bold underline" target="_blank" rel="noopener">
                        {{ item.linkText || '查看' }}
                    </a>
                    <span v-if="item.endsAt" class="text-faint text-[9px]">截止 {{ formatDate(item.endsAt) }}</span>
                </div>
            </div>
            <button type="button" class="text-faint shrink-0 p-0.5 text-xs leading-none" @click="dismiss(item.id)">✕</button>
        </div>
    </div>
</template>
