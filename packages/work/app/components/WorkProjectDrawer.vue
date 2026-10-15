<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { safeProjectColor, type WorkProject } from '../utils/work';

/** 项目色板：值最终会进内联 style（列表色点与卡片），自由文本要么再校验一次要么就是注入点。 */
const PROJECT_COLORS = [
    { key: 'Blue', value: '#3b82f6' },
    { key: 'Violet', value: '#8b5cf6' },
    { key: 'Pink', value: '#ec4899' },
    { key: 'Red', value: '#ef4444' },
    { key: 'Orange', value: '#f97316' },
    { key: 'Yellow', value: '#eab308' },
    { key: 'Green', value: '#22c55e' },
    { key: 'Teal', value: '#14b8a6' },
    { key: 'Gray', value: '#64748b' },
] as const;

type ColorKey = (typeof PROJECT_COLORS)[number]['key'];

/**
 * 项目编辑抽屉：新建与修改共用。
 *
 * `archived` 不在这里做开关——归档会连带影响今日总览与任务分组，
 * 放在列表行上让用户一眼看到当前状态，比藏在表单里更容易被确认。
 */
const props = defineProps<{ open: boolean; project: WorkProject | null; saving?: boolean }>();
const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'save', payload: { id?: string; name: string; description: string; color: string }): void;
    (e: 'remove', project: WorkProject): void;
}>();

const { t } = useI18n();

const name = ref('');
const description = ref('');
const colorKey = ref<ColorKey>('Blue');
const error = ref('');
const nameInput = ref<HTMLInputElement | null>(null);

const activeColor = computed(() => PROJECT_COLORS.find((item) => item.key === colorKey.value)?.value ?? PROJECT_COLORS[0].value);

watch(
    () => [props.open, props.project?.id] as const,
    ([open]) => {
        if (!open) return;
        name.value = props.project?.name ?? '';
        description.value = props.project?.description ?? '';
        const stored = props.project?.color ?? '';
        colorKey.value = (PROJECT_COLORS.find((item) => item.value === stored) ?? PROJECT_COLORS[0]).key;
        error.value = '';
        // 抽屉里的首个字段是用户绝大多数情况下唯一要填的，不自动聚焦就得先 Tab 好几轮
        if (import.meta.client) nextTick(() => nameInput.value?.focus());
    },
    { immediate: true },
);

function submit() {
    if (!name.value.trim()) {
        error.value = t('common.required', { field: t('work.fieldProjectName') });
        return;
    }
    emit('save', { id: props.project?.id, name: name.value.trim(), description: description.value.trim(), color: activeColor.value });
}
</script>

<template>
    <AdminDrawer :open="open" :title="project ? t('work.editProject') : t('work.newProject')" width-class="sm:max-w-xl" @close="emit('close')">
        <div class="space-y-4">
            <div v-if="error" class="app-help-error">{{ error }}</div>

            <div>
                <label class="app-label" for="work-project-name">{{ t('work.fieldProjectName') }}</label>
                <input id="work-project-name" ref="nameInput" v-model="name" class="app-input" maxlength="80" :placeholder="t('work.projectNamePlaceholder')" />
            </div>

            <div>
                <label class="app-label" for="work-project-desc">{{ t('work.fieldProjectDesc') }}</label>
                <textarea
                    id="work-project-desc"
                    v-model="description"
                    rows="3"
                    class="app-input"
                    maxlength="500"
                    :placeholder="t('work.projectDescPlaceholder')"
                />
            </div>

            <div>
                <span class="app-label">{{ t('work.fieldColor') }}</span>
                <div class="mt-1.5 flex flex-wrap items-center gap-2">
                    <button
                        v-for="item in PROJECT_COLORS"
                        :key="item.key"
                        type="button"
                        class="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
                        :class="colorKey === item.key ? 'border-[color:var(--strong)]' : '!border-transparent'"
                        :style="{ backgroundColor: item.value }"
                        :aria-label="t(`work.color${item.key}`)"
                        :aria-pressed="colorKey === item.key"
                        @click="colorKey = item.key"
                    />
                </div>
            </div>

            <div class="app-card flex items-center gap-2 !p-3">
                <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: safeProjectColor(activeColor) }" />
                <span class="text-strong min-w-0 truncate text-xs font-bold">{{ name.trim() || t('work.projectPreviewEmpty') }}</span>
            </div>
        </div>

        <template #footer>
            <button v-if="project" type="button" class="app-btn app-btn-danger mr-auto" :disabled="saving" @click="emit('remove', project)">
                {{ t('common.delete') }}
            </button>
            <button type="button" class="app-btn app-btn-outline" :disabled="saving" @click="emit('close')">{{ t('common.cancel') }}</button>
            <button type="button" class="app-btn app-btn-primary" :disabled="saving" @click="submit">
                <AppIcon v-if="saving" name="autorenew" :size="15" class="animate-spin" />
                <span>{{ t('common.save') }}</span>
            </button>
        </template>
    </AdminDrawer>
</template>
