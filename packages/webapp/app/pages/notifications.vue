<script setup lang="ts">
/**
 * 消息通知已并入个人中心子路由（/profile/notifications）。
 * 旧地址重定向以保持书签与外链可用；auth 先行，未登录仍先进登录页。
 */
definePageMeta({
    middleware: [
        'auth',
        function () {
            return navigateTo('/profile/notifications', { replace: true });
        },
    ],
});
</script>

<template>
    <div />
</template>
