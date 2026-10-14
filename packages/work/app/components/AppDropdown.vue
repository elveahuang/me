<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * 轻量下拉浮层：点击外部 / Esc 关闭，滚动或路由变化时自动收起。
 *
 * 用法：
 *   <AppDropdown align="right" width="16rem">
 *     <template #trigger="{ toggle, attrs }">
 *       <button v-bind="attrs" class="app-btn app-btn-ghost app-btn-icon" @click="toggle">…</button>
 *     </template>
 *     <template #default="{ close }">
 *       <button class="app-dropdown-item" @click="close">…</button>
 *     </template>
 *   </AppDropdown>
 */
const props = withDefaults(
    defineProps<{
        /** 面板相对触发器的对齐方向 */
        align?: 'left' | 'right';
        /** 面板最小宽度，传 CSS 值 */
        width?: string;
    }>(),
    { align: 'right', width: '14rem' },
);

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const route = useRoute();

function toggle() {
    open.value = !open.value;
}

function close() {
    open.value = false;
}

function onDocumentPointerDown(event: PointerEvent) {
    if (!open.value) return;
    const target = event.target as Node | null;
    if (root.value && target && !root.value.contains(target)) close();
}

function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open.value) {
        close();
        // 焦点回到触发器，键盘用户不会丢失位置
        (root.value?.querySelector('[data-dropdown-trigger]') as HTMLElement | null)?.focus();
    }
}

// 路由变化时收起，避免跳转后浮层残留在新页面上
watch(() => route.fullPath, close);

onMounted(() => {
    document.addEventListener('pointerdown', onDocumentPointerDown);
    document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onDocumentPointerDown);
    document.removeEventListener('keydown', onKeydown);
});

/** 透传给触发器按钮的 ARIA / 定位标记 */
const triggerAttrs = {
    'data-dropdown-trigger': '',
    'aria-haspopup': 'menu' as const,
    'aria-expanded': undefined as boolean | undefined,
};
</script>

<template>
    <div ref="root" class="relative">
        <slot name="trigger" :open="open" :toggle="toggle" :close="close" :attrs="{ ...triggerAttrs, 'aria-expanded': open }" />
        <!--
            :duration 显式兜底：leave 阶段 Vue 靠 transitionend 移除节点，
            标签页被浏览器节流（后台/未合成）时该事件可能一直不来，
            浮层会永久留在 DOM 里挡住点击。给出固定时长即可无条件下线。
        -->
        <Transition name="app-fade" :duration="{ enter: 160, leave: 160 }">
            <div
                v-if="open"
                class="app-dropdown-panel"
                :class="props.align === 'right' ? 'app-dropdown-right' : 'app-dropdown-left'"
                :style="{ width: props.width }"
                role="menu"
            >
                <slot :close="close" />
            </div>
        </Transition>
    </div>
</template>
