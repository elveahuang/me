<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';

/**
 * 用户菜单：头部右侧的纯头像下拉。
 * 登录态在此统一渲染「个人中心 / 管理后台 / 退出」（管理后台仅管理员可见），
 * 未登录时由外层直接展示登录、注册按钮。
 */
const { t } = useI18n();
const { session, signOut } = useSession();

/** 登出失败就地显示在菜单面板内（菜单保持打开、会话不清除） */
const { error: logoutError, show: showLogoutError } = useTransientError();

async function logout() {
    try {
        await signOut();
    } catch (e) {
        // 登出失败时保留本地会话并提示，不跳 /login，避免「退了还在线上」
        showLogoutError(extractApiError(e, t('common.error')));
        return;
    }
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

            <NuxtLink to="/profile" role="menuitem" class="app-dropdown-item" @click="close">
                <AppIcon name="account-outline" :size="16" />
                <span>{{ t('nav.profile') }}</span>
            </NuxtLink>
            <NuxtLink v-if="session.user.role === 'admin'" to="/admin" role="menuitem" class="app-dropdown-item" @click="close">
                <AppIcon name="shield-account-outline" :size="16" />
                <span>{{ t('nav.admin') }}</span>
            </NuxtLink>

            <div class="app-dropdown-divider" />
            <button type="button" role="menuitem" class="app-dropdown-item app-dropdown-item-danger" @click="logout">
                <AppIcon name="logout-variant" :size="16" />
                <span>{{ t('nav.logout') }}</span>
            </button>
            <p v-if="logoutError" class="app-alert app-alert-danger mx-2 mb-2 !text-[11px]">{{ logoutError }}</p>
        </template>
    </AppDropdown>
</template>
