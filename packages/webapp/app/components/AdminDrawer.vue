<script setup lang="ts">
import { useI18n } from 'vue-i18n';

interface Props {
    /** 是否展开抽屉 */
    open: boolean;
    /** 抽屉标题 */
    title?: string;
    /** 面板宽度类，简单表单可留空，字段多的表单传 'sm:max-w-2xl' 等 */
    widthClass?: string;
    /** 展开内容较大时禁止 footer 换行等，保留默认即可 */
    bodyClass?: string;
}

const props = withDefaults(defineProps<Props>(), {
    title: '',
    widthClass: 'sm:max-w-xl',
    bodyClass: '',
});

const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useI18n();

function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && props.open) emit('close');
}

watch(
    () => props.open,
    (open) => {
        if (typeof document !== 'undefined') document.body.style.overflow = open ? 'hidden' : '';
    },
);

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown);
    if (typeof document !== 'undefined') document.body.style.overflow = '';
});
</script>

<template>
    <Teleport to="body">
        <Transition name="admin-drawer">
            <div v-if="open" class="fixed inset-0 z-50 flex justify-end">
                <!-- 遮罩：点击关闭 -->
                <div class="absolute inset-0 bg-slate-900/40 backdrop-blur-xs" @click="emit('close')"></div>

                <!-- 右侧滑出面板 -->
                <div class="drawer-panel relative flex h-full w-full flex-col bg-white shadow-2xl" :class="widthClass" role="dialog" aria-modal="true">
                    <div class="flex shrink-0 items-center justify-between border-b border-slate-200/80 px-6 py-4">
                        <h2 class="text-base font-bold text-slate-800">{{ title }}</h2>
                        <button
                            type="button"
                            class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                            :title="t('common.close')"
                            :aria-label="t('common.close')"
                            @click="emit('close')"
                        >
                            ✕
                        </button>
                    </div>

                    <div class="flex-1 overflow-y-auto px-6 py-5" :class="bodyClass">
                        <slot />
                    </div>

                    <div v-if="$slots.footer" class="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200/80 px-6 py-4">
                        <slot name="footer" />
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.drawer-panel {
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}
.admin-drawer-enter-active,
.admin-drawer-leave-active {
    transition: opacity 0.2s ease;
}
.admin-drawer-enter-from,
.admin-drawer-leave-to {
    opacity: 0;
}
.admin-drawer-enter-from .drawer-panel,
.admin-drawer-leave-to .drawer-panel {
    transform: translateX(100%);
}
</style>
