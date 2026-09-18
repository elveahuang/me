<script setup lang="ts">
// 站点标题来自系统基础设置；SSR 每次请求都在 setup 读取，管理端保存后刷新即生效。
useHead({ title: useRuntimeConfig().public.siteSettings.siteTitle });
</script>

<template>
    <u-app>
        <nuxt-route-announcer />
        <nuxt-layout>
            <nuxt-page />
        </nuxt-layout>
    </u-app>
</template>
