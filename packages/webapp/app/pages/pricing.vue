<script setup lang="ts">
import {
    extractApiError,
    formatDate,
    formatYuan,
    orderStatusLabelKey,
    orderStatusTone,
    quotaUsedPercent,
    type CreateOrderResponse,
    type JsapiParams,
    type MembershipStatus,
    type OrderRecord,
    type PlansResponse,
    type Plan,
} from '@commons/contract';
import QRCode from 'qrcode';
import { useI18n } from 'vue-i18n';

definePageMeta({ middleware: 'auth' });

const { t } = useI18n();

const statusData = ref<MembershipStatus | null>(null);
const plans = ref<Plan[]>([]);
const orders = ref<OrderRecord[]>([]);
const period = ref<'monthly' | 'yearly'>('monthly');
const loading = ref(true);
const loadError = ref('');

// 支付弹窗状态
const showPayModal = ref(false);
const activeOrder = ref<CreateOrderResponse | null>(null);
const qrDataUrl = ref<string>('');
const pollingTimer = ref<ReturnType<typeof setInterval> | null>(null);
// 支付成功后延时关闭弹窗的定时器：需在手动关闭与卸载时清理，否则会在销毁后回写或重复关闭
const closeTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const paySuccess = ref(false);
const paying = ref(false);
const payError = ref('');

async function loadData() {
    loadError.value = '';
    loading.value = true;
    try {
        const [mStatus, pData, oData] = await Promise.all([
            $fetch<MembershipStatus>('/api/billing/membership'),
            $fetch<PlansResponse>('/api/plans'),
            $fetch<{ orders: OrderRecord[] }>('/api/billing/orders'),
        ]);
        statusData.value = mStatus;
        plans.value = pData.plans;
        orders.value = oData.orders;
    } catch (e) {
        // 失败时给出可见提示：否则页面没有任何套餐卡片，用户会以为平台不卖会员
        loadError.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(loadData);
onUnmounted(() => {
    stopPolling();
    clearCloseTimer();
});

function stopPolling() {
    if (pollingTimer.value) {
        clearInterval(pollingTimer.value);
        pollingTimer.value = null;
    }
}

function clearCloseTimer() {
    if (closeTimer.value) {
        clearTimeout(closeTimer.value);
        closeTimer.value = null;
    }
}

/** 支付成功后延时关闭弹窗；重复调用只保留最后一次计划。 */
function scheduleAutoClose() {
    clearCloseTimer();
    closeTimer.value = setTimeout(closePayModal, 1800);
}

/** 轮询上限：订单 2 小时过期，但渠道不可达时状态会一直是 pending，
 *  没有上限就会永久轮询（移动端同样处理）。到点停止并提示用户手动刷新。 */
const POLL_MAX_ATTEMPTS = 150; // 150 × 2s = 5 分钟
let pollAttempts = 0;

function startPolling(orderNo: string) {
    stopPolling();
    pollAttempts = 0;
    pollingTimer.value = setInterval(async () => {
        pollAttempts += 1;
        if (pollAttempts > POLL_MAX_ATTEMPTS) {
            stopPolling();
            payError.value = t('billing.pollTimeout');
            return;
        }
        try {
            const res = await $fetch<{ status: string }>(`/api/billing/orders/${orderNo}`);
            if (res.status === 'paid') {
                stopPolling();
                paySuccess.value = true;
                await loadData();
                scheduleAutoClose();
            } else if (res.status === 'closed') {
                stopPolling();
                payError.value = t('billing.payFailed');
            }
        } catch (e) {
            console.error('轮询订单状态失败:', e);
        }
    }, 2000);
}

/** 微信内浏览器 JSAPI 支付 */
function invokeWeixinJsapi(params: JsapiParams) {
    const bridge = (window as any).WeixinJSBridge;
    if (!bridge) {
        payError.value = '请在微信内打开以完成支付';
        return;
    }
    bridge.invoke('getBrandWCPayRequest', params, (res: { err_msg?: string }) => {
        if (res?.err_msg === 'get_brand_wcpay_request:ok') {
            paySuccess.value = true;
            loadData();
            scheduleAutoClose();
        } else if (res?.err_msg !== 'get_brand_wcpay_request:cancel') {
            payError.value = t('billing.payFailed');
        }
    });
}

/** 切换计费周期：同时清掉上一条购买提示，否则"暂无年付价格"会在切回月付后继续挂着 */
function switchPeriod(next: 'monthly' | 'yearly') {
    period.value = next;
    payError.value = '';
}

async function handleBuy(plan: Plan) {
    // 免费套餐无需下单：直接给出说明，避免按钮点了没有任何反应
    if (plan.code === 'free') {
        loadError.value = '';
        payError.value = t('billing.freePlanHint');
        return;
    }
    // 该套餐未配置所选周期价格时提前提示（此前会显示 ¥0.00 并在下单时才报错）
    if (period.value === 'yearly' && !plan.yearlyPriceCents) {
        payError.value = t('billing.periodUnavailable');
        return;
    }
    paying.value = true;
    payError.value = '';
    try {
        const res = await $fetch<CreateOrderResponse>('/api/billing/orders', {
            method: 'POST',
            body: { planId: plan.id, period: period.value },
        });
        activeOrder.value = res;
        paySuccess.value = false;
        showPayModal.value = true;

        if (res.mode === 'qrcode' && res.payUrl) {
            qrDataUrl.value = await QRCode.toDataURL(res.payUrl, { width: 220, margin: 1 });
            startPolling(res.orderNo);
        } else if (res.mode === 'mock') {
            startPolling(res.orderNo);
        } else if (res.mode === 'jsapi' && res.jsapiParams) {
            invokeWeixinJsapi(res.jsapiParams);
            startPolling(res.orderNo);
        } else if (res.mode === 'redirect' && res.payUrl) {
            window.location.href = res.payUrl;
        }
    } catch (e) {
        alert(extractApiError(e, t('common.error')));
    } finally {
        paying.value = false;
    }
}

async function handleMockPay() {
    if (!activeOrder.value) return;
    try {
        await $fetch(`/api/billing/orders/${activeOrder.value.orderNo}/mock-pay`, { method: 'POST' });
    } catch (e) {
        payError.value = extractApiError(e, t('common.error'));
    }
}

function closePayModal() {
    clearCloseTimer();
    stopPolling();
    showPayModal.value = false;
    activeOrder.value = null;
    qrDataUrl.value = '';
    paySuccess.value = false;
    payError.value = '';
}

const usedPercent = computed(() => quotaUsedPercent(statusData.value?.usedToday, statusData.value?.chatQuotaPerDay));
</script>

<template>
    <div class="space-y-9">
        <!-- 头部标题 -->
        <div class="mx-auto max-w-2xl text-center">
            <h1 class="text-3xl font-black tracking-tight sm:text-4xl">{{ t('billing.title') }}</h1>
            <p class="text-muted-2 mt-2 text-sm">{{ t('billing.subtitle') }}</p>
        </div>

        <!-- 加载失败提示：否则页面无套餐卡片，用户会以为平台不提供会员 -->
        <div v-if="loadError" class="app-alert app-alert-danger mx-auto flex max-w-2xl items-center justify-between gap-3">
            <span class="text-xs">{{ loadError }}</span>
            <button type="button" class="app-btn app-btn-soft shrink-0 !px-3 !py-1 !text-[11px]" @click="loadData">
                {{ t('common.retry') }}
            </button>
        </div>

        <!-- 当前会员状态卡片 -->
        <div v-if="statusData" class="app-card p-6 sm:p-8">
            <div class="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div class="flex flex-wrap items-center gap-3">
                        <span class="text-xl font-bold"> {{ t('billing.myPlan') }}：{{ statusData.plan?.name || t('billing.freePlan') }} </span>
                        <span :class="['app-badge', statusData.expiresAt ? 'app-badge-success' : 'app-badge-neutral']">
                            {{ statusData.expiresAt ? t('common.enabled') : t('billing.currentPlan') }}
                        </span>
                    </div>
                    <p class="text-faint mt-1.5 text-xs">
                        {{ statusData.expiresAt ? `${t('billing.expiresAt')}：${formatDate(statusData.expiresAt)}` : t('billing.unlimited') }}
                    </p>
                </div>

                <div class="min-w-[220px]">
                    <div class="text-soft mb-1.5 flex items-center justify-between text-xs font-semibold">
                        <span>{{ t('billing.usedToday') }}</span>
                        <span class="font-bold"> {{ statusData.usedToday }} / {{ statusData.chatQuotaPerDay ?? '∞' }} </span>
                    </div>
                    <div class="app-progress">
                        <div class="app-progress-bar" :style="{ width: `${statusData.chatQuotaPerDay === null ? 100 : usedPercent}%` }" />
                    </div>
                </div>
            </div>
        </div>

        <!-- 月付 / 年付 切换 -->
        <div class="flex justify-center">
            <div class="app-panel inline-flex gap-1 p-1.5">
                <button :class="['app-btn', period === 'monthly' ? 'app-btn-soft' : 'app-btn-ghost']" @click="switchPeriod('monthly')">
                    {{ t('billing.monthly') }}
                </button>
                <button :class="['app-btn', period === 'yearly' ? 'app-btn-soft' : 'app-btn-ghost']" @click="switchPeriod('yearly')">
                    <span>{{ t('billing.yearly') }}</span>
                    <span class="app-chip app-chip-brand">-20%</span>
                </button>
            </div>
        </div>

        <!-- 未打开支付弹窗时的购买提示：payError 平时只在弹窗内渲染，弹窗没开就没人看到，点了按钮等于静默失败 -->
        <div v-if="payError && !showPayModal" class="app-alert app-alert-warning mx-auto max-w-2xl">
            <span class="text-xs">{{ payError }}</span>
        </div>

        <!-- 套餐卡片网格 -->
        <div class="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div
                v-for="p in plans"
                :key="p.id"
                :class="['app-card relative flex flex-col justify-between p-6 sm:p-8', p.code === statusData?.plan?.code ? 'app-card-brand' : '']"
            >
                <div
                    v-if="p.code === 'pro'"
                    class="bg-brand-gradient absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5 text-[10px] font-black tracking-wider uppercase shadow-xs"
                >
                    POPULAR
                </div>

                <div>
                    <div class="flex items-center justify-between">
                        <h3 class="text-xl font-black">{{ p.name }}</h3>
                        <span v-if="p.code === statusData?.plan?.code" class="app-badge app-badge-success">{{ t('billing.currentPlan') }}</span>
                    </div>
                    <p class="text-muted-2 mt-2 min-h-[36px] text-xs leading-relaxed">{{ p.description }}</p>

                    <div class="mt-6 flex items-baseline gap-1">
                        <span class="text-3xl font-black"> ¥{{ period === 'yearly' ? formatYuan(p.yearlyPriceCents) : formatYuan(p.monthlyPriceCents) }} </span>
                        <span class="text-faint text-xs font-medium">{{ period === 'yearly' ? t('billing.perYear') : t('billing.perMonth') }}</span>
                    </div>

                    <ul class="text-soft mt-6 space-y-3 text-xs">
                        <li class="flex items-center gap-2">
                            <span class="text-brand font-bold">✓</span>
                            <span
                                >{{ t('billing.dailyQuota') }}：<strong>{{ p.chatQuotaPerDay ?? t('billing.unlimited') }}</strong></span
                            >
                        </li>
                        <li class="flex items-center gap-2">
                            <span class="text-brand font-bold">✓</span>
                            <span>ReAct 智能体多步推理调度</span>
                        </li>
                        <li class="flex items-center gap-2">
                            <span class="text-brand font-bold">✓</span>
                            <span>MCP 服务器与 Generative UI 渲染</span>
                        </li>
                    </ul>
                </div>

                <div class="mt-8">
                    <button v-if="p.code === statusData?.plan?.code" disabled class="app-btn app-btn-outline w-full">
                        {{ t('billing.currentPlan') }}
                    </button>
                    <button v-else :disabled="paying" class="app-btn app-btn-primary w-full !py-3" @click="handleBuy(p)">
                        {{ p.code === 'free' ? t('billing.freePlan') : t('billing.buyNow') }}
                    </button>
                </div>
            </div>
        </div>

        <!-- 支付弹窗 Modal -->
        <div
            v-if="showPayModal"
            class="fixed inset-0 z-50 flex items-center justify-center p-4"
            style="background-color: rgb(15 23 42 / 0.5); backdrop-filter: blur(4px)"
        >
            <div class="app-card w-full max-w-md p-6 sm:p-8">
                <div class="app-divider flex items-center justify-between border-t-0 pb-3">
                    <h3 class="text-base font-bold">{{ t('billing.payMethod') }}</h3>
                    <button class="app-btn app-btn-ghost !px-2" @click="closePayModal">✕</button>
                </div>

                <div class="py-6 text-center">
                    <template v-if="paySuccess">
                        <div class="text-brand mb-2 text-5xl">✓</div>
                        <h4 class="text-lg font-bold">{{ t('billing.paySuccess') }}</h4>
                    </template>

                    <template v-else>
                        <p class="text-muted-2 text-xs">
                            {{ t('billing.orderNo') }}：<span class="font-mono">{{ activeOrder?.orderNo }}</span>
                        </p>
                        <p class="mt-2 text-2xl font-black">¥{{ formatYuan(activeOrder?.amountCents) }}</p>

                        <div v-if="activeOrder?.mode === 'qrcode' && qrDataUrl" class="my-4 flex flex-col items-center">
                            <img :src="qrDataUrl" alt="WeChat Pay QR" class="h-48 w-48 rounded-2xl border p-2" style="border-color: var(--line)" />
                            <p class="text-faint mt-2 text-xs">{{ t('billing.scanToPay') }}</p>
                        </div>

                        <div v-if="activeOrder?.mode === 'mock'" class="app-alert app-alert-warning my-4 text-left">
                            <p class="text-xs font-bold">🛠️ {{ t('billing.mockPay') }}</p>
                            <p class="mt-1 text-[11px] opacity-90">{{ t('billing.mockPayHint') }}</p>
                            <button class="app-btn app-btn-soft mt-3 w-full" @click="handleMockPay">{{ t('billing.mockPayConfirm') }}</button>
                        </div>

                        <p v-if="payError" class="app-alert app-alert-danger mt-3">{{ payError }}</p>

                        <div class="text-faint mt-4 flex items-center justify-center gap-2 text-xs">
                            <span class="bg-brand inline-block h-2 w-2 animate-ping rounded-full" />
                            {{ t('billing.paying') }}
                        </div>
                    </template>
                </div>

                <div class="app-divider flex justify-end pt-3">
                    <button class="app-btn app-btn-outline" @click="closePayModal">{{ t('common.close') }}</button>
                </div>
            </div>
        </div>

        <!-- 常见问题解答 FAQ -->
        <div class="app-card space-y-4 p-6 sm:p-8">
            <div class="text-center sm:text-left">
                <h3 class="flex items-center gap-2 text-lg font-black">
                    <span>❓</span>
                    <span>{{ t('billing.faqTitle') }}</span>
                </h3>
                <p class="text-faint mt-1 text-xs">关于会员方案、每日额度重置与权益退订的常见疑问</p>
            </div>
            <div class="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2">
                <div class="border-line bg-surface-2/60 rounded-2xl border p-4">
                    <p class="text-default text-sm font-bold">💡 {{ t('billing.faq1Q') }}</p>
                    <p class="text-muted-2 mt-2 text-xs leading-relaxed">{{ t('billing.faq1A') }}</p>
                </div>
                <div class="border-line bg-surface-2/60 rounded-2xl border p-4">
                    <p class="text-default text-sm font-bold">💳 {{ t('billing.faq2Q') }}</p>
                    <p class="text-muted-2 mt-2 text-xs leading-relaxed">{{ t('billing.faq2A') }}</p>
                </div>
            </div>
        </div>

        <!-- 历史订单记录 -->
        <div class="app-card p-6 sm:p-8">
            <h3 class="text-lg font-black">{{ t('nav.orders') }}</h3>
            <p class="text-faint mt-0.5 text-xs">查看最近的会员购买记录与开通状态</p>

            <div class="mt-4 overflow-x-auto">
                <table class="app-table">
                    <thead>
                        <tr>
                            <th>{{ t('billing.orderNo') }}</th>
                            <th>{{ t('nav.plans') }}</th>
                            <th>周期</th>
                            <th>{{ t('billing.amount') }}</th>
                            <th>渠道</th>
                            <th>{{ t('common.status') }}</th>
                            <th>时间</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="o in orders" :key="o.id">
                            <td class="text-muted-2 font-mono text-[11px]">{{ o.orderNo }}</td>
                            <td class="font-semibold">{{ o.planCode }}</td>
                            <td class="text-soft">{{ o.period === 'yearly' ? t('billing.yearly') : t('billing.monthly') }}</td>
                            <td class="font-bold">¥{{ formatYuan(o.amountCents) }}</td>
                            <td class="text-soft">{{ o.provider === 'wechat' ? t('billing.wechatPay') : t('billing.mockPay') }}</td>
                            <td>
                                <span :class="['app-badge', orderStatusTone(o.status)]">{{ t(orderStatusLabelKey(o.status)) }}</span>
                            </td>
                            <td class="text-faint">{{ formatDate(o.createdAt) }}</td>
                        </tr>
                        <tr v-if="!orders.length">
                            <td colspan="7" class="text-faint py-8 text-center text-xs">{{ t('admin.tableEmpty') }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>
