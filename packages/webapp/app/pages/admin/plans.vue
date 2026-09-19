<script setup lang="ts">
import { extractApiError } from '@commons/contract';
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
        monthlyPriceYuan: (plan.monthlyPriceCents / 100).toFixed(2),
        yearlyPriceYuan: plan.yearlyPriceCents !== null ? (plan.yearlyPriceCents / 100).toFixed(2) : '',
        enabled: plan.enabled,
        sortOrder: plan.sortOrder,
    });
    errorMessage.value = null;
}

async function save() {
    if (saving.value) return;
    errorMessage.value = null;
    if (!form.code.trim()) {
        errorMessage.value = '套餐编码不能为空';
        return;
    }
    if (!form.name.trim()) {
        errorMessage.value = '套餐名称不能为空';
        return;
    }
    const monthlyPriceCents = Math.round(parseFloat(form.monthlyPriceYuan || '0') * 100);
    const yearlyPriceCents = form.yearlyPriceYuan.trim() ? Math.round(parseFloat(form.yearlyPriceYuan) * 100) : null;

    // 输入框清空后 v-model 给的是空串，Number('') 会得到 0：服务端 chatQuotaPerDay 要求
    // 正整数或 null，0 会被 .positive() 拒成 400，"留空不限"根本提交不出去。
    const quotaInput = form.chatQuotaPerDay;
    const chatQuotaPerDay = quotaInput === '' || quotaInput === null || quotaInput === undefined ? null : Number(quotaInput);
    if (chatQuotaPerDay !== null && (!Number.isInteger(chatQuotaPerDay) || chatQuotaPerDay < 1)) {
        errorMessage.value = '每日对话配额需为正整数，留空表示不限量';
        return;
    }

    const sortOrder = Number(form.sortOrder);
    if (!Number.isInteger(sortOrder)) {
        errorMessage.value = '显示排序需为整数';
        return;
    }

    if (Number.isNaN(monthlyPriceCents) || monthlyPriceCents < 0) {
        errorMessage.value = '月付价格必须为非负数';
        return;
    }
    if (yearlyPriceCents !== null && (Number.isNaN(yearlyPriceCents) || yearlyPriceCents < 0)) {
        errorMessage.value = '年付价格必须为非负数';
        return;
    }

    saving.value = true;
    try {
        if (editing.value?.id) {
            await $fetch(`/api/admin/plans/${editing.value.id}`, {
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
        await $fetch(`/api/admin/plans/${id}`, { method: 'DELETE' });
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
                <p class="app-page-subtitle">会员套餐定义每日对话配额与周期定价；free 为注册用户的免费兜底档</p>
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
                        <label class="app-label">套餐编码 (创建后不可修改)</label>
                        <input v-model="form.code" :disabled="Boolean(editing?.id)" placeholder="如 pro / max" class="app-input" />
                    </div>
                    <div>
                        <label class="app-label">套餐名称</label>
                        <input v-model="form.name" placeholder="如 专业版 Pro" class="app-input" />
                    </div>
                </div>

                <div>
                    <label class="app-label">套餐描述与权益</label>
                    <input v-model="form.description" placeholder="套餐核心权益简述" class="app-input" />
                </div>

                <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                        <label class="app-label">每日对话配额 (留空不限)</label>
                        <input v-model="form.chatQuotaPerDay" type="number" placeholder="留空为无限制" class="app-input" />
                    </div>
                    <div>
                        <label class="app-label">月付价格 (元)</label>
                        <input v-model="form.monthlyPriceYuan" type="number" step="0.01" class="app-input" />
                    </div>
                    <div>
                        <label class="app-label">年付价格 (元，留空不支持)</label>
                        <input v-model="form.yearlyPriceYuan" type="number" step="0.01" placeholder="留空为无" class="app-input" />
                    </div>
                </div>

                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <label class="app-label">显示排序 (越小越靠前)</label>
                        <input v-model="form.sortOrder" type="number" class="app-input" />
                    </div>
                    <div class="flex items-center gap-2 pt-6">
                        <label class="text-soft flex cursor-pointer items-center gap-2 text-xs font-bold">
                            <input v-model="form.enabled" type="checkbox" class="app-checkbox" />
                            <span>启用上架并对用户可见</span>
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
                        <th>编码</th>
                        <th>名称</th>
                        <th>每日配额</th>
                        <th>月价</th>
                        <th>年价</th>
                        <th>排序</th>
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
                        <td class="text-soft font-semibold">{{ p.chatQuotaPerDay ?? '∞ 不限量' }}</td>
                        <td class="text-strong font-black tabular-nums">¥{{ (p.monthlyPriceCents / 100).toFixed(2) }}</td>
                        <td class="text-soft tabular-nums">{{ p.yearlyPriceCents !== null ? `¥${(p.yearlyPriceCents / 100).toFixed(2)}` : '—' }}</td>
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
