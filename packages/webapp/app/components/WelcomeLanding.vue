<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * 未登录访客在首页（`/`）看到的平台介绍。
 * 首页对已登录用户是对话主体（HomeChat），这里的 SEO 元信息由 pages/index.vue 统一设置。
 */
const { t } = useI18n();

// 文案全部走 welcome.* 契约键，切语言即时生效；tag 是两端一致的技术徽标词，保留在数据里
const featureDefs = [
    { icon: '🧠', tag: 'Reasoning Stream', titleKey: 'welcome.fReasoningTitle', descKey: 'welcome.fReasoningDesc' },
    { icon: '📚', tag: 'Dual RAG', titleKey: 'welcome.fRagTitle', descKey: 'welcome.fRagDesc' },
    { icon: '🛠️', tag: 'MCP & Skills', titleKey: 'welcome.fToolsTitle', descKey: 'welcome.fToolsDesc' },
    { icon: '💳', tag: 'Quota & Billing', titleKey: 'welcome.fBillingTitle', descKey: 'welcome.fBillingDesc' },
];
</script>

<template>
    <div class="space-y-14 py-6">
        <BulletinBanner position="home" />

        <!-- Hero 主视觉 -->
        <section class="app-card relative overflow-hidden p-8 text-center sm:p-14">
            <div class="bg-brand-soft-gradient pointer-events-none absolute inset-0 opacity-70" />
            <div class="relative">
                <div class="app-chip app-chip-brand mx-auto !px-4 !py-1.5 !text-[11px] !font-bold">
                    <span>🚀</span>
                    <span>{{ t('welcome.heroChip') }}</span>
                </div>

                <h1 class="mt-6 text-3xl font-black tracking-tight sm:text-5xl lg:text-6xl">
                    {{ t('welcome.heroTitleA') }}
                    <span class="text-brand"> {{ t('welcome.heroTitleB') }} </span>
                </h1>

                <p class="text-muted-2 mx-auto mt-4 max-w-2xl text-xs leading-relaxed sm:text-sm">
                    {{ t('welcome.heroDesc') }}
                </p>

                <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <NuxtLink to="/login" class="app-btn app-btn-primary !px-6 !py-3 sm:!text-sm"> {{ t('nav.login') }} → </NuxtLink>
                    <NuxtLink to="/register" class="app-btn app-btn-outline !px-5 !py-3 sm:!text-sm">
                        {{ t('nav.register') }}
                    </NuxtLink>
                    <NuxtLink to="/pricing" class="app-btn app-btn-soft !px-4 !py-3 sm:!text-sm"> 💎 {{ t('nav.pricing') }} </NuxtLink>
                </div>

                <!-- 平台关键指标 -->
                <div class="app-divider mt-12 grid grid-cols-2 gap-4 pt-8 sm:grid-cols-4">
                    <div>
                        <div class="text-2xl font-black">4+</div>
                        <div class="text-faint mt-0.5 text-xs">{{ t('welcome.statModels') }}</div>
                    </div>
                    <div>
                        <div class="text-brand text-2xl font-black">100%</div>
                        <div class="text-faint mt-0.5 text-xs">{{ t('welcome.statRag') }}</div>
                    </div>
                    <div>
                        <div class="text-2xl font-black">&lt; 10ms</div>
                        <div class="text-faint mt-0.5 text-xs">{{ t('welcome.statRateLimit') }}</div>
                    </div>
                    <div>
                        <div class="text-soft text-2xl font-black">Web + Native</div>
                        <div class="text-faint mt-0.5 text-xs">{{ t('welcome.statCross') }}</div>
                    </div>
                </div>
            </div>
        </section>

        <!-- 四大核心支柱 -->
        <section class="space-y-6">
            <div class="text-center">
                <h2 class="text-2xl font-black tracking-tight">{{ t('welcome.pillarsTitle') }}</h2>
                <p class="text-faint mt-1 text-xs">{{ t('welcome.pillarsSubtitle') }}</p>
            </div>

            <div class="grid gap-5 sm:grid-cols-2">
                <div v-for="f in featureDefs" :key="f.tag" class="app-card app-card-hover p-6 sm:p-7">
                    <div class="flex items-center justify-between">
                        <span class="text-3xl">{{ f.icon }}</span>
                        <span class="app-chip font-mono">{{ f.tag }}</span>
                    </div>
                    <h3 class="mt-4 text-base font-black">{{ t(f.titleKey) }}</h3>
                    <p class="text-muted-2 mt-2 text-xs leading-relaxed">{{ t(f.descKey) }}</p>
                </div>
            </div>
        </section>
    </div>
</template>
