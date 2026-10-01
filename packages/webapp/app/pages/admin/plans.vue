<script setup lang="ts">
import { extractApiError, formatYuan } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

const { t } = useI18n();

interface AdminPlan {
    id: string;
    code: string;
    name: string;
    description: string;
    chatQuotaPerDay: number | null;
    monthlyPriceCents: number;
    yearlyPriceCents: number | null;
    enabled: boolean;
    sortOrder: number;
}

const plans = ref<AdminPlan[]>([]);
const editing = ref<Partial<AdminPlan> | null>(null);
const errorMessage = ref<string | null>(null);
/** 提交中标记：抽屉页脚原本没有 disabled，双击会创建两条重复套餐 */
const saving = ref(false);

const form = reactive({
    code: '',
    name: '',
    description: '',
    /** 空串是 number 输入框「留空=不限量」的取值，不能当作 0 */
    chatQuotaPerDay: null as number | null | '',
    monthlyPriceYuan: '0',
    yearlyPriceYuan: '',
    enabled: true,
    sortOrder: 0,
});

async function load() {
    try {
        plans.value = await $fetch<AdminPlan[]>('/api/admin/plans');
        errorMessage.value = null;
    } catch (e) {
        // 失败时清空并提示：否则表格空态会被读成「还没有套餐」
        plans.value = [];
        errorMessage.value = extractApiError(e, t('common.loadFailed'));
    }
}

onMounted(load);

function openCreate() {
    editing.value = {};
    Object.assign(form, {
        code: '',
        name: '',
        description: '',
        chatQuotaPerDay: null,
        monthlyPriceYuan: '0',
        yearlyPriceYuan: '',
        enabled: true,
        sortOrder: 0,
    });
    errorMessage.value = null;
}

function openEdit(plan: AdminPlan) {
    editing.value = plan;
    Object.assign(form, {
        code: plan.code,
        name: plan.name,
        description: plan.description,
        chatQuotaPerDay: plan.chatQuotaPerDay,
        monthlyPriceYuan: formatYuan(plan.monthlyPriceCents),
        yearlyPriceYuan: plan.yearlyPriceCents !== null ? formatYuan(plan.yearlyPriceCents) : '',
        enabled: plan.enabled,
        sortOrder: plan.sortOrder,
    });
    errorMessage.value = null;
}

async function save() {
    if (saving.value) return;
    errorMessage.value = null;
    if (!form.code.trim()) {
        errorMessage.value = t('adminForm.planErrCodeRequired');
        return;
    }
    if (!form.name.trim()) {
        errorMessage.value = t('adminForm.planErrNameRequired');
        return;
    }
    const monthlyPriceCents = Math.round(parseFloat(form.monthlyPriceYuan || '0') * 100);
    const yearlyPriceCents = form.yearlyPriceYuan.trim() ? Math.round(parseFloat(form.yearlyPriceYuan) * 100) : null;

    // 输入框清空后 v-model 给的是空串，Number('') 会得到 0：服务端 chatQuotaPerDay 要求
    // 正整数或 null，0 会被 .positive() 拒成 400，"留空不限"根本提交不出去。
    const quotaInput = form.chatQuotaPerDay;
    const chatQuotaPerDay = quotaInput === '' || quotaInput === null || quotaInput === undefined ? null : Number(quotaInput);
    if (chatQuotaPerDay !== null && (!Number.isInteger(chatQuotaPerDay) || chatQuotaPerDay < 1)) {
        errorMessage.value = t('adminForm.planErrQuotaPositive');
        return;
    }

    const sortOrder = Number(form.sortOrder);
    if (!Number.isInteger(sortOrder)) {
        errorMessage.value = t('adminForm.planErrSortInt');
        return;
    }

    if (Number.isNaN(monthlyPriceCents) || monthlyPriceCents < 0) {
        errorMessage.value = t('adminForm.planErrMonthlyNonNeg');
        return;
    }
    if (yearlyPriceCents !== null && (Number.isNaN(yearlyPriceCents) || yearlyPriceCents < 0)) {
        errorMessage.value = t('adminForm.planErrYearlyNonNeg');
        return;
    }

    saving.value = true;
    try {
        if (editing.value?.id) {
            await $fetch(`/api/admin/plans/${encodeURIComponent(editing.value.id)}`, {
                method: 'PATCH',
                body: {
                    name: form.name.trim(),
                    description: form.description.trim(),
                    chatQuotaPerDay,
                    monthlyPriceCents,
                    yearlyPriceCents,
                    enabled: form.enabled,
                    sortOrder,
                },
            });
        } else {
            await $fetch('/api/admin/plans', {
                method: 'POST',
                body: {
                    code: form.code.trim(),
                    name: form.name.trim(),
                    description: form.description.trim(),
                    chatQuotaPerDay,
                    monthlyPriceCents,
                    yearlyPriceCents,
                    enabled: form.enabled,
                    sortOrder,
                },
            });
        }
        editing.value = null;
        await load();
    } catch (e) {
        // 直接读 e.data 在 e 为原生 Error 时会抛 TypeError，统一走契约层的归一化
        errorMessage.value = extractApiError(e, t('adminForm.saveFailed'));
    } finally {
        saving.value = false;
    }
}

async function remove(id: string) {
    if (!confirm(t('adminForm.deleteConfirm'))) return;
    try {
        await $fetch(`/api/admin/plans/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await load();
    } catch (e) {
        errorMessage.value = extractApiError(e, t('adminForm.deleteFailed'));
    }
}
</script>

<template>
    <div class="space-y-6">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ t('nav.plans') }}</h1>
                <p class="app-page-subtitle">{{ t('adminForm.plansSubtitle') }}</p>
            </div>
            <div class="app-page-actions">
                <button class="app-btn app-btn-primary app-btn-sm" @click="openCreate">+ {{ t('admin.addRecord') }}</button>
            </div>
        </div>

        <!-- 列表加载失败独立提示：否则表格空态会被读成「还没有套餐」 -->
        <div v-if="errorMessage && !editing" class="app-alert app-alert-danger">
            {{ errorMessage }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>

        <!-- 编辑 / 新建表单（右侧抽屉） -->
        <AdminDrawer :open="editing !== null" :title="editing?.id ? t('common.edit') : t('admin.addRecord')" width-class="sm:max-w-2xl" @close="editing = null">
            <div class="space-y-4">
                <p v-if="errorMessage" class="app-alert app-alert-danger">{{ errorMessage }}</p>

                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <label class="app-label">{{ t('adminForm.planCodeLabel') }}</label>
                        <input
                            :aria-label="t('adminForm.planCodeLabel')"
                            v-model="form.code"
                            :disabled="Boolean(editing?.id)"
                            :placeholder="t('adminForm.planCodePlaceholder')"
                            class="app-input"
                        />
                    </div>
                    <div>
                        <label class="app-label">{{ t('adminForm.planNameLabel') }}</label>
                        <input
                            :aria-label="t('adminForm.planNameLabel')"
                            v-model="form.name"
                            :placeholder="t('adminForm.planNamePlaceholder')"
                            class="app-input"
                        />
                    </div>
                </div>

                <div>
                    <label class="app-label">{{ t('adminForm.planDescLabel') }}</label>
                    <input
                        :aria-label="t('adminForm.planDescLabel')"
                        v-model="form.description"
                        :placeholder="t('adminForm.planDescPlaceholder')"
                        class="app-input"
                    />
                </div>

                <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                        <label class="app-label">{{ t('adminForm.planQuotaLabel') }}</label>
                        <input
                            :aria-label="t('adminForm.planQuotaLabel')"
                            v-model="form.chatQuotaPerDay"
                            type="number"
                            :placeholder="t('adminForm.planQuotaPlaceholder')"
                            class="app-input"
                        />
                    </div>
                    <div>
                        <label class="app-label">{{ t('adminForm.planMonthlyLabel') }}</label>
                        <input v-model="form.monthlyPriceYuan" type="number" step="0.01" :aria-label="t('adminForm.planMonthlyLabel')" class="app-input" />
                    </div>
                    <div>
                        <label class="app-label">{{ t('adminForm.planYearlyLabel') }}</label>
                        <input
                            :aria-label="t('adminForm.planYearlyLabel')"
                            v-model="form.yearlyPriceYuan"
                            type="number"
                            step="0.01"
                            :placeholder="t('adminForm.planYearlyPlaceholder')"
                            class="app-input"
                        />
                    </div>
                </div>

                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <label class="app-label">{{ t('adminForm.planSortLabel') }}</label>
                        <input v-model="form.sortOrder" type="number" :aria-label="t('adminForm.planSortLabel')" class="app-input" />
                    </div>
                    <div class="flex items-center gap-2 pt-6">
                        <label class="text-soft flex cursor-pointer items-center gap-2 text-xs font-bold">
                            <input v-model="form.enabled" type="checkbox" class="app-checkbox" />
                            <span>{{ t('adminForm.planEnabledLabel') }}</span>
                        </label>
                    </div>
                </div>
            </div>
            <template #footer>
                <button class="app-btn app-btn-ghost" :disabled="saving" @click="editing = null">{{ t('common.cancel') }}</button>
                <button class="app-btn app-btn-primary" :disabled="saving" @click="save">
                    {{ saving ? t('common.loading') : t('common.save') }}
                </button>
            </template>
        </AdminDrawer>

        <!-- 套餐表格 -->
        <div class="app-table-wrap">
            <table class="app-table">
                <thead>
                    <tr>
                        <th>{{ t('adminForm.planColCode') }}</th>
                        <th>{{ t('adminForm.planColName') }}</th>
                        <th>{{ t('adminForm.planColQuota') }}</th>
                        <th>{{ t('adminForm.planColMonthly') }}</th>
                        <th>{{ t('adminForm.planColYearly') }}</th>
                        <th>{{ t('adminForm.planColSort') }}</th>
                        <th>{{ t('common.status') }}</th>
                        <th class="text-right">{{ t('common.actions') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="p in plans" :key="p.id">
                        <td class="text-strong font-mono font-bold">{{ p.code }}</td>
                        <td>
                            <div class="text-strong font-bold">{{ p.name }}</div>
                            <div class="text-faint mt-0.5 max-w-xs truncate text-[11px]">{{ p.description }}</div>
                        </td>
                        <td class="text-soft font-semibold">{{ p.chatQuotaPerDay ?? t('adminForm.planQuotaUnlimited') }}</td>
                        <td class="text-strong font-black tabular-nums">¥{{ formatYuan(p.monthlyPriceCents) }}</td>
                        <td class="text-soft tabular-nums">{{ p.yearlyPriceCents !== null ? `¥${formatYuan(p.yearlyPriceCents)}` : '—' }}</td>
                        <td class="text-faint">{{ p.sortOrder }}</td>
                        <td>
                            <span :class="p.enabled ? 'app-badge-success' : 'app-badge-neutral'" class="app-badge">
                                {{ p.enabled ? t('common.enabled') : t('common.disabled') }}
                            </span>
                        </td>
                        <td>
                            <div class="app-table-actions">
                                <button class="app-btn app-btn-soft app-btn-sm" @click="openEdit(p)">{{ t('common.edit') }}</button>
                                <button v-if="p.code !== 'free'" class="app-btn app-btn-danger app-btn-sm" @click="remove(p.id)">
                                    {{ t('common.delete') }}
                                </button>
                            </div>
                        </td>
                    </tr>
                    <tr v-if="!plans.length">
                        <td colspan="8" class="!whitespace-normal">
                            <div class="app-empty">
                                <span class="app-empty-icon">📦</span>
                                <p class="app-empty-title">{{ t('admin.tableEmpty') }}</p>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
