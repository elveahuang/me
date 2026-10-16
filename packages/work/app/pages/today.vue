<script setup lang="ts">
/**
 * `/today` 已并入 `/`（今日总览就是首页）。
 *
 * 旧深链还留在浏览器历史与收藏里，301 回根而不是留一个 404。
 */
await navigateTo('/', { redirectCode: 301, replace: true });
</script>

<template>
    <div />
</template>
