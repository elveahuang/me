<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * 用户菜单：头部右侧的纯头像下拉。
 * 登录态在此统一渲染「个人中心 / 管理后台 / 退出」（管理后台仅管理员可见），
 * 未登录时由外层直接展示登录、注册按钮。
 */
const { t } = useI18n();
const { session, signOut } = useSession();

async function logout() {
    await signOut();
    await navigateTo('/login');
}
</script>

<template>
    <AppDropdown v-if="session" align="right" width="15rem">
        <template #trigger="{ toggle, attrs }">
            <button
                v-bind="attrs"
                type="button"
                class="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] p-0.5 transition-colors hover:border-[color:var(--brand)]"
                :title="session.user.name"
                :aria-label="session.user.name"
                @click="toggle"
            >
                <span class="app-avatar h-7 w-7 text-[11px]">{{ session.user.name?.[0]?.toUpperCase() || 'U' }}</span>
            </button>
        </template>

        <template #default="{ close }">
            <div class="flex items-center gap-2.5 px-2 py-2">
                <span class="app-avatar h-9 w-9 text-sm">{{ session.user.name?.[0]?.toUpperCase() || 'U' }}</span>
                <div class="min-w-0">
                    <p class="truncate text-xs font-bold">{{ session.user.name }}</p>
                    <p class="text-faint truncate text-[11px]">{{ session.user.email }}</p>
                </div>
            </div>
            <div class="app-dropdown-divider" />

            <NuxtLink to="/profile" class="app-dropdown-item" @click="close">
                <AppIcon name="account-outline" :size="16" />
                <span>{{ t('nav.profile') }}</span>
            </NuxtLink>
            <NuxtLink v-if="session.user.role === 'admin'" to="/admin" class="app-dropdown-item" @click="close">
                <AppIcon name="shield-account-outline" :size="16" />
                <span>{{ t('nav.admin') }}</span>
            </NuxtLink>

            <div class="app-dropdown-divider" />
            <button type="button" class="app-dropdown-item app-dropdown-item-danger" @click="logout">
                <AppIcon name="logout-variant" :size="16" />
                <span>{{ t('nav.logout') }}</span>
            </button>
        </template>
    </AppDropdown>
</template>
