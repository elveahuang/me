<script setup lang="ts">
import { ATTACHMENT_CATEGORIES, extractApiError, formatBytes, type AttachmentRecord } from '@commons/contract';
import { useI18n } from 'vue-i18n';

/**
 * 图片 URL 输入 + 附件选择器（管理端表单用）。
 *
 * 解决的问题：资讯封面、宣传栏配图这类字段原来只能手填 URL，
 * 但附件是 owner-only 且私有桶返回的是会过期的预签名地址——
 * 手填进去要么立刻失效、要么对别的用户不可见。
 * 这里在选中附件时把它固定为稳定地址（公开桶公共地址 / 私有桶站内代理路径）。
 */
const props = withDefaults(defineProps<{ modelValue: string; category?: string; placeholder?: string }>(), {
    category: 'image',
    placeholder: '',
});

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const { t } = useI18n();

const open = ref(false);
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
        const res = await $fetch<{ attachments: AttachmentRecord[] }>('/api/attachments', {
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
    // 写入稳定引用：公开桶用公共地址，私有桶用站内下载路径（其他用户也能正常显示）
    emit('update:modelValue', item.url || `/api/attachments/${item.id}/raw`);
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
        emit('update:modelValue', created.url || `/api/attachments/${created.id}/raw`);
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
            <div v-if="open" class="app-modal-backdrop" @click.self="open = false">
                <div class="app-modal">
                    <div class="app-modal-header">
                        <h3 class="text-strong text-sm font-bold">{{ t('adminForm.pickFromAttachments') }}</h3>
                        <button type="button" class="text-hover-strong text-faint" @click="open = false">✕</button>
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
                                <img :src="item.url || `/api/attachments/${item.id}/raw`" :alt="item.filename" class="h-24 w-full object-cover" />
                            </button>
                        </div>
                        <p v-else class="text-faint py-8 text-center text-xs">{{ t('attachments.emptyHint') }}</p>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>
