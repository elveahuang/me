<script setup lang="ts">
/**
 * `/` 就是对话。
 *
 * 今日页（今天要跑 / 今天已跑 / 简报）已随侧栏收敛退场，而浏览器历史与书签里还留着 `/`，
 * 所以这一页只做一次重定向，不拉任何数据——把逻辑留在页面里等于留一个没人看的清单。
 */
await navigateTo('/chat', { redirectCode: 302, replace: true });
</script>

<template>
    <div />
</template>
