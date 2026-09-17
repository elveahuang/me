<script setup lang="ts">
import { computed } from 'vue';
import { APP_ICONS, type AppIconName } from '~/utils/app-icons';

/**
 * 本地图标组件：图标数据在构建期从 @iconify-json/mdi 内联（见 scripts/generate-icons.mjs），
 * 运行时零网络请求，颜色继承 currentColor，因此天然跟随主题与深浅色。
 *
 * 用法：<AppIcon name="account-outline" :size="18" />
 */
const props = withDefaults(
    defineProps<{
        /** 图标名（Iconify mdi 名称，不带 `mdi-` 前缀） */
        name: AppIconName | (string & {});
        /** 尺寸，数字按 px 处理 */
        size?: number | string;
        /** 是否随内容基线对齐（图标按钮里一般不需要） */
        decorative?: boolean;
    }>(),
    { size: 18, decorative: true },
);

const icon = computed(() => APP_ICONS[props.name as string] ?? null);
const dimension = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size));
</script>

<template>
    <svg
        v-if="icon"
        class="app-icon"
        :viewBox="icon.viewBox"
        :width="dimension"
        :height="dimension"
        :aria-hidden="decorative ? 'true' : undefined"
        :role="decorative ? undefined : 'img'"
        focusable="false"
        v-html="icon.body"
    />
    <!-- 图标名写错时给一个可见占位，避免静默渲染成空白（开发期一眼可见） -->
    <span v-else class="app-icon app-icon-missing" :style="{ width: dimension, height: dimension }" :title="`未注册的图标：${name}`" />
</template>
