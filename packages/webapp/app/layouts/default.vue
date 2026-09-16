<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { authClient, fetchSession } from '~/utils/auth-client';

const { t, locale } = useI18n();
const { $setLocale } = useNuxtApp();
const { isDark, toggleMode } = useTheme();

const session = ref<{ user: { id: string; name: string; email: string; role: string } } | null>(null);

onMounted(async () => {
    session.value = (await fetchSession()) as any;
});

function toggleLanguage() {
    const next = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN';
    $setLocale(next);
}

async function logout() {
    await authClient.signOut();
    navigateTo('/login');
}
</script>

<template>
    <div class="bg-surface-2 text-strong flex min-h-screen flex-col antialiased">
        <!-- 现代化顶部毛玻璃导航 -->
        <header
            class="sticky top-0 z-20 border-b backdrop-blur-md transition-all duration-300"
            style="border-color: var(--line); background-color: color-mix(in oklab, var(--surface) 82%, transparent)"
        >
            <div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
                <!-- 品牌 Logo -->
                <NuxtLink to="/" class="group flex items-center gap-2.5">
                    <div class="app-avatar h-9 w-9 text-sm shadow-xs transition-transform group-hover:scale-105">EE</div>
                    <span class="text-brand text-lg font-black tracking-tight">
                        {{ t('common.appName') }}
                    </span>
                </NuxtLink>

                <!-- 导航项与功能按键 -->
                <nav class="flex items-center gap-1.5 text-xs font-medium sm:gap-3 sm:text-sm">
                    <NuxtLink to="/chat" class="app-nav-link hidden sm:inline-flex" active-class="app-nav-link-active">
                        {{ t('nav.chat') }}
                    </NuxtLink>
                    <NuxtLink to="/pricing" class="app-nav-link hidden sm:inline-flex" active-class="app-nav-link-active">
                        {{ t('nav.pricing') }}
                    </NuxtLink>
                    <NuxtLink v-if="session && session.user.role === 'admin'" to="/admin" class="app-nav-link hidden items-center gap-1 lg:inline-flex">
                        <span>⚡</span>
                        <span>{{ t('nav.admin') }}</span>
                    </NuxtLink>

                    <ThemeSwitcher />

                    <!-- 深色模式快捷开关 -->
                    <button
                        type="button"
                        class="app-btn app-btn-ghost !px-2.5"
                        :title="isDark ? '切换为浅色' : '切换为深色'"
                        :aria-label="isDark ? '切换为浅色' : '切换为深色'"
                        @click="toggleMode"
                    >
                        <span>{{ isDark ? '🌙' : '☀️' }}</span>
                    </button>

                    <!-- 多语言切换 -->
                    <button type="button" class="app-btn app-btn-outline !px-2.5" :title="t('profile.languageSelect')" @click="toggleLanguage">
                        <span>🌐</span>
                        <span>{{ locale === 'zh-CN' ? 'EN' : '中文' }}</span>
                    </button>

                    <!-- 用户登录状态 -->
                    <template v-if="session">
                        <NuxtLink
                            to="/profile"
                            class="flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 transition-colors hover:border-[color:var(--brand)]"
                            style="border-color: var(--line); background-color: var(--surface)"
                        >
                            <div class="app-avatar h-6 w-6 !rounded-full text-[11px]">
                                {{ session.user.name?.[0]?.toUpperCase() || 'U' }}
                            </div>
                            <span class="max-w-[80px] truncate text-xs font-semibold sm:max-w-[120px]">
                                {{ session.user.name }}
                            </span>
                        </NuxtLink>
                        <button class="text-faint rounded-lg p-1.5 transition-colors hover:text-[color:var(--danger)]" :title="t('nav.logout')" @click="logout">
                            ⏻
                        </button>
                    </template>
                    <template v-else>
                        <NuxtLink to="/login" class="app-nav-link">
                            {{ t('nav.login') }}
                        </NuxtLink>
                        <NuxtLink to="/register" class="app-btn app-btn-primary">
                            {{ t('nav.register') }}
                        </NuxtLink>
                    </template>
                </nav>
            </div>
        </header>

        <!-- 主体视图容器 -->
        <main class="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
            <slot />
        </main>

        <!-- 页脚 -->
        <footer class="app-divider text-faint py-6 text-center text-xs" style="background-color: color-mix(in oklab, var(--surface) 60%, transparent)">
            <div class="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 sm:flex-row">
                <span>© 2026 {{ t('common.appName') }} · All Rights Reserved</span>
                <span class="flex items-center gap-3">
                    <span class="bg-brand inline-block h-2 w-2 rounded-full"></span>
                    <span>System Operational</span>
                </span>
            </div>
        </footer>
    </div>
</template>
