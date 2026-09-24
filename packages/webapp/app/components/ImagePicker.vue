<script setup lang="ts">
import { extractApiError, formatBytes, type AttachmentRecord, type AttachmentsResponse } from '@commons/contract';
import { useI18n } from 'vue-i18n';

/**
 * 图片 URL 输入 + 附件选择器（管理端表单用）。
 *
 * 解决的问题：资讯封面、宣传栏配图这类字段原来只能手填 URL，
 * 但附件是 owner-only 且私有桶返回的是会过期的预签名地址——
 * 手填进去要么立刻失效、要么对别的用户不可见。
 * 已知边界：私有桶下 item.url 是限时预签名、/raw 代理仅附件所有者可访问，
 * 所以选中附件写入的引用对非所有者/未登录访客不保证长期可显示；
 * 公共读需要另建公开代理通道，不在本组件职责内。
 */
const props = withDefaults(defineProps<{ modelValue: string; category?: string; placeholder?: string }>(), {
    category: 'image',
    placeholder: '',
});

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const { t } = useI18n();

const open = ref(false);
/** 弹层的键盘可达性：Esc 关、Tab 圈闭、滚动锁与焦点归还 */
const pickerPanel = ref<HTMLElement | null>(null);
useDrawerFocus(
    () => open.value,
    pickerPanel,
    () => {
        open.value = false;
    },
);
const loading = ref(false);
const error = ref('');
const items = ref<AttachmentRecord[]>([]);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const previewUrl = computed(() => props.modelValue || '');

async function load() {
    loading.value = true;
    error.value = '';
    try {
        const res = await $fetch<AttachmentsResponse>('/api/attachments', {
            query: { pageSize: 30, category: props.category === 'image' ? 'image' : undefined },
        });
        // 只列出图片类，避免在封面/配图场景选到 pdf 等非图片
        items.value = res.attachments.filter((a) => a.isImage);
    } catch (e) {
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

function choose(item: AttachmentRecord) {
    // 公开桶 url 是稳定公共地址；私有桶 url 是限时预签名，/raw 兜底也仅所有者可见——私有桶配置下选出的封面不保证访客长期可见
    emit('update:modelValue', item.url || `/api/attachments/${encodeURIComponent(item.id)}/raw`);
    open.value = false;
}

async function uploadAndChoose(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    uploading.value = true;
    error.value = '';
    try {
        const form = new FormData();
        form.append('file', file);
        form.append('category', 'image');
        const created = await $fetch<AttachmentRecord>('/api/attachments', { method: 'POST', body: form });
        emit('update:modelValue', created.url || `/api/attachments/${encodeURIComponent(created.id)}/raw`);
        open.value = false;
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    } finally {
        uploading.value = false;
    }
}

watch(open, (value) => {
    if (value) void load();
});
</script>

<template>
    <div class="space-y-2">
        <div class="flex gap-2">
            <input
                :value="modelValue"
                :aria-label="placeholder || t('adminForm.imageUrlPlaceholder')"
                :placeholder="placeholder || t('adminForm.imageUrlPlaceholder')"
                class="app-input flex-1 !font-mono !text-xs"
                @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
            />
            <button type="button" class="app-btn app-btn-outline app-btn-sm shrink-0" @click="open = true">
                {{ t('adminForm.pickFromAttachments') }}
            </button>
            <button v-if="modelValue" type="button" class="app-btn app-btn-ghost app-btn-sm shrink-0" @click="emit('update:modelValue', '')">
                {{ t('common.clear') }}
            </button>
        </div>
        <img v-if="previewUrl" :src="previewUrl" :alt="modelValue" class="border-line max-h-32 rounded-lg border object-cover" />

        <Teleport to="body">
            <div
                v-if="open"
                ref="pickerPanel"
                class="app-modal-backdrop"
                role="dialog"
                aria-modal="true"
                :aria-label="t('adminForm.pickFromAttachments')"
                @click.self="open = false"
            >
                <div class="app-modal">
                    <div class="app-modal-header">
                        <h3 class="text-strong text-sm font-bold">{{ t('adminForm.pickFromAttachments') }}</h3>
                        <button type="button" class="text-hover-strong text-faint" :aria-label="t('common.close')" @click="open = false">✕</button>
                    </div>

                    <div class="app-modal-body space-y-3">
                        <div>
                            <button type="button" class="app-btn app-btn-outline app-btn-sm" :disabled="uploading" @click="fileInput?.click()">
                                {{ uploading ? t('attachments.uploading') : t('adminForm.uploadImage') }}
                            </button>
                            <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="uploadAndChoose" />
                        </div>

                        <p v-if="error" class="app-help-error">{{ error }}</p>

                        <div v-if="loading" class="grid grid-cols-3 gap-2">
                            <div v-for="i in 6" :key="i" class="app-skeleton h-24 !rounded-lg" />
                        </div>
                        <div v-else-if="items.length" class="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto">
                            <button
                                v-for="item in items"
                                :key="item.id"
                                type="button"
                                class="border-line border-hover-brand overflow-hidden rounded-lg border transition-colors"
                                :title="`${item.filename} · ${formatBytes(item.size)}`"
                                @click="choose(item)"
                            >
                                <img
                                    :src="item.url || `/api/attachments/${encodeURIComponent(item.id)}/raw`"
                                    :alt="item.filename"
                                    class="h-24 w-full object-cover"
                                />
                            </button>
                        </div>
                        <p v-else class="text-faint py-8 text-center text-xs">{{ t('attachments.emptyHint') }}</p>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>
