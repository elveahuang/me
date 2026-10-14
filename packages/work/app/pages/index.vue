<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * 首页 = 本机工作台的对话入口。
 *
 * 与 `/chat/:agentId` 的唯一区别是**可以在对话头部切换智能体**；
 * work 没有账号体系，进得来这台机器的人就是主人，因此不需要登录态判定。
 */
const { t } = useI18n();

const siteTitle = useRuntimeConfig().public.siteSettings.siteTitle;
const seoDescription = computed(() => t('home.seoDescription'));
useSeoMeta({
    description: seoDescription,
    ogTitle: siteTitle,
    ogDescription: seoDescription,
});
</script>

<template>
    <HomeChat />
</template>
