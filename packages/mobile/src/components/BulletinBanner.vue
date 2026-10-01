<script setup lang="ts">
import { formatDate, type BulletinListResponse, type BulletinRecord } from '@commons/contract';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { api, apiUrl } from '../api/auth';

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
        const res = await api<BulletinListResponse>(`/api/bulletins?position=${encodeURIComponent(props.position)}`);
        bulletins.value = res.bulletins;
    } catch {
        // 宣传栏是辅助内容，失败静默
    }
}

onMounted(() => {
    try {
        // localStorage 里可能是任何 JSON（旧版本/手工改动），只有字符串数组才可用
        const raw = JSON.parse(localStorage.getItem('mobile_dismissed_bulletins') || '[]');
        dismissed.value = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch {
        dismissed.value = [];
    }
    void load();
});

const visible = computed(() => bulletins.value.filter((item) => !dismissed.value.includes(item.id)));

const router = useRouter();

/**
 * 站内相对地址走应用内路由：原生壳里 target=_blank 的新窗口会解析到 capacitor://localhost（404）
 * 或跳出 App 到系统浏览器；只有外部 http(s) 链接才开新窗口。
 */
function openLink(url: string) {
    if (url.startsWith('/')) {
        void router.push(url);
        return;
    }
    window.open(apiUrl(url), '_blank', 'noopener');
}

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
            <!-- 站内相对地址在原生壳里会解析到 capacitor://localhost 而 404，统一经 apiUrl 绝对化（绝对 http(s) 原样返回） -->
            <img v-if="item.imageUrl" :src="apiUrl(item.imageUrl)" :alt="item.title" class="h-10 w-10 shrink-0 rounded-lg object-cover" />
            <div class="min-w-0 flex-1">
                <p class="text-[11px] font-bold">{{ item.title }}</p>
                <p v-if="item.content" class="text-muted-2 mt-0.5 line-clamp-2 text-[10px] leading-relaxed">{{ item.content }}</p>
                <div class="mt-1.5 flex items-center gap-2">
                    <a v-if="item.linkUrl" :href="apiUrl(item.linkUrl)" class="app-link text-[10px] underline" @click.prevent="openLink(item.linkUrl)">
                        {{ item.linkText || t('common.viewDetail') }}
                    </a>
                    <span v-if="item.endsAt" class="text-faint text-[9px]">{{ t('common.endsAt', { date: formatDate(item.endsAt) }) }}</span>
                </div>
            </div>
            <button type="button" class="text-faint -m-1 shrink-0 p-1.5 text-xs leading-none" :aria-label="t('common.close')" @click="dismiss(item.id)">
                ✕
            </button>
        </div>
    </div>
</template>
