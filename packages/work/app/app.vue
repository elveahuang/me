<script setup lang="ts">
// 站点标题来自系统基础设置（改名走 useSiteTitle 的共享镜像），<html lang> 跟随当前语言；SSR 每次请求都在 setup 读取，刷新即正确。
const { $currentLocale } = useNuxtApp();
useHead({
    title: useSiteTitle(),
    htmlAttrs: { lang: $currentLocale },
});
</script>

<template>
    <u-app>
        <nuxt-route-announcer />
        <nuxt-layout>
            <nuxt-page />
        </nuxt-layout>
    </u-app>
</template>
