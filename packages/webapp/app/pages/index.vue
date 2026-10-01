<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * 首页 = 用户端的单一对话入口。
 *
 * 已登录：直接渲染对话（HomeChat），与 `/chat/:agentId` 的唯一区别是**可以在对话头部切换智能体**；
 * 未登录：渲染平台介绍（WelcomeLanding），保留根路径的搜索摘要与分享卡片元信息。
 * 因此根路径不挂 `auth` 中间件，落地页对访客仍然可读、可被搜索引擎收录。
 */
const { t } = useI18n();
// 走 useSession 而非裸 fetchSession：SSR 同样透传 cookie（load 内部用 ssrCookieHeaders），
// 结果写进共享 useState 后，布局头部不再重复探测、客户端也不会在服务端已判定未登录时闪回登录态
const { session, load } = useSession();
await load();

const siteTitle = useRuntimeConfig().public.siteSettings.siteTitle;
const seoDescription = computed(() => t('home.seoDescription'));
useSeoMeta({
    description: seoDescription,
    ogTitle: siteTitle,
    ogDescription: seoDescription,
});
</script>

<template>
    <HomeChat v-if="session" />
    <WelcomeLanding v-else />
</template>
