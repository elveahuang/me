<script setup lang="ts">
import {
    bestYearlyDiscountPercent,
    extractApiError,
    formatDate,
    formatYuan,
    isActivePaidPlan,
    orderStatusLabelKey,
    orderStatusTone,
    quotaUsedPercent,
    type CreateOrderResponse,
    type JsapiParams,
    type MembershipStatus,
    type OrderRecord,
    type OrdersResponse,
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
/** 支付弹窗的键盘可达性：原先只有 ✕ 能关（没有 Esc、Tab 还能跑到页面背后、body 照旧滚） */
const payModalPanel = ref<HTMLElement | null>(null);
useDrawerFocus(() => showPayModal.value, payModalPanel, closePayModal);
const activeOrder = ref<CreateOrderResponse | null>(null);
const qrDataUrl = ref<string>('');
const pollingTimer = ref<ReturnType<typeof setTimeout> | null>(null);
/** 轮询轮次：stopPolling 递增它，让「已发出未返回」的那一次请求回来后不再续排 */
let pollGeneration = 0;
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
            $fetch<OrdersResponse>('/api/billing/orders'),
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
    // 递增轮次让在途请求作废：只清 timeout 的话，正在 await 的那次 tick 返回后
    // 会无条件重新挂表，关闭弹窗/离开页面后链子复活并继续打订单查询接口。
    pollGeneration += 1;
    if (pollingTimer.value) {
        clearTimeout(pollingTimer.value);
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

/** 订单查询 GET 有真实副作用（查渠道/补开通/关单），必须一次请求结束再排下一次，
 *  用 setInterval 会在慢响应时并发叠加轰同一订单（移动端同规则）。 */
function startPolling(orderNo: string) {
    stopPolling();
    const generation = pollGeneration;
    /** 响应回来时若已被 stopPolling（关弹窗 / 页面卸载 / 换新订单）则整段丢弃，不再续排 */
    const alive = () => generation === pollGeneration;
    pollAttempts = 0;
    const tick = async () => {
        if (!alive()) return;
        pollAttempts += 1;
        if (pollAttempts > POLL_MAX_ATTEMPTS) {
            stopPolling();
            payError.value = t('billing.pollTimeout');
            return;
        }
        try {
            const res = await $fetch<{ status: string }>(`/api/billing/orders/${encodeURIComponent(orderNo)}`);
            if (!alive()) return;
            if (res.status === 'paid') {
                paySuccess.value = true;
                await loadData();
                // 套餐列表拉取期间可能已关弹窗/离开页面，这时不该再排那个 1.8s 的自动关闭
                if (!alive()) return;
                stopPolling();
                scheduleAutoClose();
                return;
            }
            if (res.status === 'closed') {
                stopPolling();
                payError.value = t('billing.payFailed');
                return;
            }
        } catch {
            // 单次查询失败（网络抖动等）不中断轮询，下一次 tick 会重试；超过上限由 attempt 计数收口
        }
        // 关键一步：await 之后必须重新确认轮次，否则这就是关闭后仍在续链的那一行
        if (!alive()) return;
        pollingTimer.value = setTimeout(() => void tick(), 2000);
    };
    pollingTimer.value = setTimeout(() => void tick(), 2000);
}

/** 微信内浏览器 JSAPI 支付 */
function invokeWeixinJsapi(params: JsapiParams) {
    const bridge = (window as any).WeixinJSBridge;
    if (!bridge) {
        payError.value = t('billing.wechatOnlyInApp');
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
            /**
             * 二维码生成失败只影响「这一格图有没有画出来」，绝不能顺带走掉整条支付编排：
             * QRCode.toDataURL 抛错时订单已经创建、弹窗已经打开，而轮询是权益生效的唯一前端路径。
             * 落在外层 catch 里的后果是——用户真付了钱，界面永远停在「等待支付」脉冲，
             * 权益不刷新、也没有任何一条属于这个失败的文案。
             */
            try {
                qrDataUrl.value = await QRCode.toDataURL(res.payUrl, { width: 220, margin: 1 });
            } catch {
                payError.value = t('billing.qrGenerateFailed');
            }
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
        // 走既有 payError 呈现：下单失败时弹窗尚未打开，页级提示（v-if="payError && !showPayModal"）会显示；
        // 若是弹窗已开之后的分支失败，弹窗内也渲染同一份 payError
        payError.value = extractApiError(e, t('common.error'));
    } finally {
        paying.value = false;
    }
}

async function handleMockPay() {
    if (!activeOrder.value) return;
    try {
        await $fetch(`/api/billing/orders/${encodeURIComponent(activeOrder.value.orderNo)}/mock-pay`, { method: 'POST' });
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

/** 折扣角标按套餐真实价格计算，不再写死 -20%（写死会与实际折扣不符） */
const yearlyDiscount = computed(() => bestYearlyDiscountPercent(plans.value));

/** 当前生效的免费档：没有可续费的权益，按钮保持禁用展示态 */
function isDisabledPlan(plan: Plan): boolean {
    return plan.code === statusData.value?.plan?.code && !statusData.value?.expiresAt;
}

function planActionLabel(plan: Plan): string {
    if (isActivePaidPlan(plan, statusData.value)) return t('billing.renew');
    if (plan.monthlyPriceCents === 0) return t('billing.freePlan');
    return t('billing.buyNow');
}
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
                        <span class="text-xl font-bold">
                            {{ t('billing.myPlan') }}{{ t('common.colon') }}{{ statusData.plan?.name || t('billing.freePlan') }}
                        </span>
                        <span :class="['app-badge', statusData.expiresAt ? 'app-badge-success' : 'app-badge-neutral']">
                            {{ statusData.expiresAt ? t('common.enabled') : t('billing.currentPlan') }}
                        </span>
                    </div>
                    <p class="text-faint mt-1.5 text-xs">
                        {{ statusData.expiresAt ? `${t('billing.expiresAt')}${t('common.colon')}${formatDate(statusData.expiresAt)}` : t('billing.unlimited') }}
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
                    <span v-if="yearlyDiscount !== null" class="app-chip app-chip-brand">-{{ yearlyDiscount }}%</span>
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
                    {{ t('billing.hotBadge') }}
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
                                >{{ t('billing.dailyQuota') }}{{ t('common.colon') }}<strong>{{ p.chatQuotaPerDay ?? t('billing.unlimited') }}</strong></span
                            >
                        </li>
                        <li class="flex items-center gap-2">
                            <span class="text-brand font-bold">✓</span>
                            <span>{{ t('billing.featureReAct') }}</span>
                        </li>
                        <li class="flex items-center gap-2">
                            <span class="text-brand font-bold">✓</span>
                            <span>{{ t('billing.featureMcpUi') }}</span>
                        </li>
                    </ul>
                </div>

                <div class="mt-8">
                    <!-- 当前付费套餐仍可续费（服务端顺延到期时间），只有免费档保持禁用展示态 -->
                    <button v-if="isDisabledPlan(p)" disabled class="app-btn app-btn-outline w-full">
                        {{ t('billing.currentPlan') }}
                    </button>
                    <button v-else :disabled="paying" class="app-btn app-btn-primary w-full !py-3" @click="handleBuy(p)">
                        {{ planActionLabel(p) }}
                    </button>
                </div>
            </div>
        </div>

        <!-- 支付弹窗 Modal -->
        <div v-if="showPayModal" ref="payModalPanel" class="app-modal-backdrop" role="dialog" aria-modal="true" :aria-label="t('billing.payMethod')">
            <div class="app-modal">
                <div class="app-modal-header">
                    <h3 class="text-sm font-bold">{{ t('billing.payMethod') }}</h3>
                    <button class="app-btn app-btn-ghost app-btn-icon" :aria-label="t('common.close')" @click="closePayModal">✕</button>
                </div>

                <div class="app-modal-body text-center">
                    <template v-if="paySuccess">
                        <div class="text-brand mb-2 text-5xl">✓</div>
                        <h4 class="text-lg font-bold">{{ t('billing.paySuccess') }}</h4>
                    </template>

                    <template v-else>
                        <p class="text-muted-2 text-xs">
                            {{ t('billing.orderNo') }}{{ t('common.colon') }}<span class="font-mono">{{ activeOrder?.orderNo }}</span>
                        </p>
                        <p class="mt-2 text-2xl font-black">¥{{ formatYuan(activeOrder?.amountCents) }}</p>

                        <div v-if="activeOrder?.mode === 'qrcode' && qrDataUrl" class="my-4 flex flex-col items-center">
                            <img :src="qrDataUrl" alt="WeChat Pay QR" class="border-line h-48 w-48 rounded-2xl border p-2" />
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

                <div class="app-modal-footer">
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
                <p class="text-faint mt-1 text-xs">{{ t('billing.faqSubtitle') }}</p>
            </div>
            <div class="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2">
                <div class="app-panel p-4">
                    <p class="text-default text-sm font-bold">💡 {{ t('billing.faq1Q') }}</p>
                    <p class="text-muted-2 mt-2 text-xs leading-relaxed">{{ t('billing.faq1A') }}</p>
                </div>
                <div class="app-panel p-4">
                    <p class="text-default text-sm font-bold">💳 {{ t('billing.faq2Q') }}</p>
                    <p class="text-muted-2 mt-2 text-xs leading-relaxed">{{ t('billing.faq2A') }}</p>
                </div>
            </div>
        </div>

        <!-- 历史订单记录 -->
        <div class="app-card p-6 sm:p-8">
            <h3 class="text-lg font-black">{{ t('nav.orders') }}</h3>
            <p class="text-faint mt-0.5 text-xs">{{ t('billing.recentOrdersHint') }}</p>

            <div class="mt-4 overflow-x-auto">
                <table class="app-table">
                    <thead>
                        <tr>
                            <th>{{ t('billing.orderNo') }}</th>
                            <th>{{ t('nav.plans') }}</th>
                            <th>{{ t('profile.orderPeriod') }}</th>
                            <th>{{ t('billing.amount') }}</th>
                            <th>{{ t('profile.orderChannel') }}</th>
                            <th>{{ t('common.status') }}</th>
                            <th>{{ t('profile.orderCreatedAt') }}</th>
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
