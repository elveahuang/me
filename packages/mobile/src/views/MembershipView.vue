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
    type Plan,
    type PlansResponse,
} from '@commons/contract';
import { IonButtons, IonContent, IonHeader, IonModal, IonPage, IonRefresher, IonRefresherContent, IonTitle, IonToolbar, onIonViewWillEnter } from '@ionic/vue';
import QRCode from 'qrcode';
import { computed, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/auth';

const { t } = useI18n();

const status = ref<MembershipStatus | null>(null);
const plans = ref<Plan[]>([]);
const orders = ref<OrderRecord[]>([]);
const period = ref<'monthly' | 'yearly'>('monthly');
const loading = ref(true); // 首帧即加载态：数据要等 onMounted/onIonViewWillEnter 之后的请求，初值 false 会让「暂无…」空态先闪一帧
const paying = ref(false);
const payModalOpen = ref(false);
const activeOrder = ref<CreateOrderResponse | null>(null);
const qrCodeDataUrl = ref('');
const pollingTimer = ref<number | null>(null);
/** 支付成功后延时关闭弹层的定时器：组件卸载时必须清理，否则会在页面销毁后写状态并重复 loadData */
const closeTimer = ref<number | null>(null);
const payError = ref('');
const paySuccess = ref(false);
/** 模拟支付提交中标记，防止连点重复下单 */
const mockPaying = ref(false);
/** 页面级加载错误：与支付弹层内的 payError 分开，避免失败被只在弹层渲染的文案吞掉 */
const loadError = ref('');

/** 下拉刷新与标签页回场刷新并发：先发后回的旧响应会把上一轮数据写回来（与附件/通知页同用序号守卫） */
let loadSeq = 0;

async function loadData() {
    const seq = ++loadSeq;
    loading.value = true;
    loadError.value = '';
    try {
        const [sRes, pRes, oRes] = await Promise.all([
            api<MembershipStatus>('/api/billing/membership'),
            api<PlansResponse>('/api/plans'),
            api<OrdersResponse>('/api/billing/orders'),
        ]);
        if (seq !== loadSeq) return;
        status.value = sRes;
        plans.value = pRes.plans.filter((p) => p.enabled);
        orders.value = oRes.orders;
    } catch (e) {
        if (seq !== loadSeq) return;
        loadError.value = extractApiError(e, t('common.error'));
    } finally {
        if (seq === loadSeq) loading.value = false;
    }
}

async function handleRefresh(event: CustomEvent) {
    await loadData();
    (event.target as HTMLIonRefresherElement).complete();
}

// 标签页组件会随切换保活，onMounted 只在首次触发；每次进入本页时刷新会员状态与订单，
// 否则在支付页外部完成支付后切回标签仍显示旧状态。
onIonViewWillEnter(loadData);
onUnmounted(() => {
    stopPolling();
    clearCloseTimer();
});

function stopPolling() {
    // 递增轮次作废在途请求：只清 timeout 的话，正在 await 的那次 tick 回来后仍会重新挂表，
    // 关掉弹层/离开页面之后链子复活，继续以 2s 间隔打有副作用的订单查询接口
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

/** 支付成功后延时关闭弹层并刷新；登记到 closeTimer 以便卸载/重开时清理 */
function scheduleAutoClose() {
    clearCloseTimer();
    closeTimer.value = window.setTimeout(async () => {
        closeTimer.value = null;
        payModalOpen.value = false;
        await loadData();
    }, 1500);
}

/** 轮询上限：渠道不可达时订单会一直是 pending，没有上限就会永久轮询 */
const POLL_MAX_ATTEMPTS = 150; // 150 × 2s = 5 分钟
let pollAttempts = 0;
/** 轮询轮次：stopPolling 递增它，让「已发出未返回」的那一次请求回来后不再续排 */
let pollGeneration = 0;

/**
 * 订单查询 GET 有副作用（触发渠道查询、补开通或关单），必须链式：
 * 用 setTimeout 在本次响应 settle 后再排下一次，请求超过 2s 时不会并发轰同一订单。
 */
function startPolling(orderNo: string) {
    stopPolling();
    const generation = pollGeneration;
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
            const data = await api<{ status: string }>(`/api/billing/orders/${encodeURIComponent(orderNo)}`);
            if (!alive()) return;
            if (data.status === 'paid') {
                stopPolling();
                paySuccess.value = true;
                scheduleAutoClose();
                return;
            }
            if (data.status === 'closed') {
                stopPolling();
                payError.value = t('billing.payFailed');
                return;
            }
        } catch {
            // 轮询失败继续重试
        }
        // 关键一步：await 之后必须重新确认轮次，否则这就是关弹窗后仍在续链的那一行
        if (!alive()) return;
        pollingTimer.value = window.setTimeout(() => void tick(), 2000);
    };
    pollingTimer.value = window.setTimeout(() => void tick(), 2000);
}

/** 微信内 JSAPI 支付 */
function invokeWeixinJsapi(params: JsapiParams) {
    const bridge = (window as any).WeixinJSBridge;
    if (!bridge) {
        payError.value = t('billing.wechatOnlyInApp');
        return;
    }
    bridge.invoke('getBrandWCPayRequest', params, (res: { err_msg?: string }) => {
        if (res?.err_msg === 'get_brand_wcpay_request:ok') {
            paySuccess.value = true;
            scheduleAutoClose();
        } else if (res?.err_msg !== 'get_brand_wcpay_request:cancel') {
            payError.value = t('billing.payFailed');
        }
    });
}

function switchPeriod(next: 'monthly' | 'yearly') {
    period.value = next;
    // 弹层外的本地提示（免费套餐说明 / 该套餐无年付）不跨周期残留，与 Web pricing.vue 同规则
    if (!payModalOpen.value) payError.value = '';
}

async function handleSubscribe(plan: Plan) {
    // 免费套餐无需下单：给出说明而不是静默返回（否则按钮点了没反应）
    if (plan.code === 'free') {
        payError.value = t('billing.freePlanHint');
        return;
    }
    // 未开放所选周期时提前提示，避免显示 ¥0.00 并等到下单才报错
    if (period.value === 'yearly' && !plan.yearlyPriceCents) {
        payError.value = t('billing.periodUnavailable');
        return;
    }
    if (paying.value) return;
    paying.value = true;
    payError.value = '';
    paySuccess.value = false;
    qrCodeDataUrl.value = '';

    try {
        const res = await api<CreateOrderResponse>('/api/billing/orders', {
            method: 'POST',
            body: JSON.stringify({ planId: plan.id, period: period.value }),
        });
        activeOrder.value = res;
        payModalOpen.value = true;

        if (res.mode === 'qrcode' && res.payUrl) {
            /**
             * 二维码生成失败只影响「这一格图有没有画出来」，绝不能顺带走掉整条支付编排：
             * QRCode.toDataURL 抛错时订单已经创建、弹窗已经打开，而轮询是权益生效的唯一前端路径。
             * 落在外层 catch 里的后果是——用户真付了钱，界面永远停在「等待支付」脉冲，
             * 权益不刷新、也没有任何一条属于这个失败的文案。
             */
            try {
                qrCodeDataUrl.value = await QRCode.toDataURL(res.payUrl, { width: 220, margin: 1 });
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
        payError.value = extractApiError(e, t('common.error'));
    } finally {
        paying.value = false;
    }
}

async function handleMockPay() {
    if (!activeOrder.value || mockPaying.value) return;
    mockPaying.value = true;
    try {
        await api(`/api/billing/orders/${encodeURIComponent(activeOrder.value.orderNo)}/mock-pay`, { method: 'POST' });
    } catch (e) {
        payError.value = extractApiError(e, t('common.error'));
    } finally {
        mockPaying.value = false;
    }
}

function closePayModal() {
    stopPolling();
    clearCloseTimer();
    payModalOpen.value = false;
    activeOrder.value = null;
    qrCodeDataUrl.value = '';
    paySuccess.value = false;
    payError.value = '';
}

const usedPercent = computed(() => quotaUsedPercent(status.value?.usedToday, status.value?.chatQuotaPerDay));

/** 折扣角标按套餐真实价格计算，不再写死 -20% */
const yearlyDiscount = computed(() => bestYearlyDiscountPercent(plans.value));

/** 当前免费档没有可续费权益，按钮保持禁用展示态；付费套餐到期前可续费 */
function isDisabledPlan(plan: Plan): boolean {
    return plan.code === status.value?.plan?.code && !status.value?.expiresAt;
}

function planActionLabel(plan: Plan): string {
    if (isActivePaidPlan(plan, status.value)) return t('billing.renew');
    if (plan.monthlyPriceCents === 0) return t('billing.freePlan');
    return t('billing.buyNow');
}
</script>

<template>
    <ion-page>
        <ion-header class="ion-no-border">
            <ion-toolbar>
                <!-- 本页是 /tabs 常驻标签页：不放 ion-back-button（与 HomeView/MeView 一致），原生返回由标签导航接管 -->
                <ion-title class="!text-sm font-black">{{ t('billing.title') }}</ion-title>
            </ion-toolbar>
        </ion-header>

        <ion-content>
            <template v-slot:fixed>
                <ion-refresher @ion-refresh="handleRefresh">
                    <ion-refresher-content :pulling-text="t('common.pullToRefresh')" refreshing-spinner="crescent" />
                </ion-refresher>
            </template>

            <div class="space-y-5 p-4">
                <!-- 加载失败提示：否则首屏请求失败时页面只剩默认值，看起来像"没有套餐" -->
                <div v-if="loadError" class="app-alert app-alert-danger flex items-center justify-between gap-2 !text-[11px]">
                    <span>{{ loadError }}</span>
                    <button type="button" class="app-btn app-btn-soft shrink-0 !px-2.5 !py-1 !text-[10px]" @click="loadData">
                        {{ t('common.retry') }}
                    </button>
                </div>

                <!-- 支付前置校验的本地失败在弹层打开前就 return，payError 只在弹层内渲染——弹窗没开时需要页级出口，否则点击表现为静默失败 -->
                <div v-if="payError && !payModalOpen" class="app-alert app-alert-danger !text-[11px]">{{ payError }}</div>

                <!-- 首次加载骨架：避免失败/加载中显示成"免费版"造成误解 -->
                <div v-if="loading && !plans.length" class="space-y-3">
                    <div class="app-skeleton h-32" />
                    <div class="app-skeleton h-48" />
                </div>

                <!-- 当前会员状态 -->
                <div v-else class="app-card overflow-hidden">
                    <div class="bg-brand-gradient p-5">
                        <div class="flex items-center justify-between">
                            <div>
                                <span class="app-chip">
                                    {{ status?.expiresAt ? t('common.enabled') : t('billing.freePlan') }}
                                </span>
                                <h2 class="mt-2 text-xl font-black">{{ status?.plan?.name || t('billing.freePlan') }}</h2>
                            </div>
                            <div class="text-3xl">👑</div>
                        </div>

                        <div class="on-brand-line mt-4 space-y-2 border-t pt-3 text-xs opacity-95">
                            <div class="flex justify-between">
                                <span>{{ t('billing.dailyQuota') }}</span>
                                <span class="font-bold">
                                    {{
                                        status?.chatQuotaPerDay === null || status?.chatQuotaPerDay === undefined
                                            ? t('billing.unlimited')
                                            : `${status.usedToday} / ${status.chatQuotaPerDay}`
                                    }}
                                </span>
                            </div>
                            <div v-if="status?.expiresAt" class="flex justify-between">
                                <span>{{ t('billing.expiresAt') }}</span>
                                <span class="font-bold">{{ formatDate(status.expiresAt) }}</span>
                            </div>
                            <div v-if="status?.chatQuotaPerDay" class="app-progress">
                                <div class="app-progress-bar" :style="{ width: `${usedPercent}%` }" />
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 周期切换 -->
                <div class="flex justify-center">
                    <div class="app-panel inline-flex gap-1 p-1.5">
                        <button :class="['app-btn', period === 'monthly' ? 'app-btn-soft' : 'app-btn-ghost']" @click="switchPeriod('monthly')">
                            {{ t('billing.monthly') }}
                        </button>
                        <button :class="['app-btn', period === 'yearly' ? 'app-btn-soft' : 'app-btn-ghost']" @click="switchPeriod('yearly')">
                            <span>{{ t('billing.yearly') }}</span>
                            <span v-if="yearlyDiscount !== null" class="app-chip app-chip-brand !text-[9px]">-{{ yearlyDiscount }}%</span>
                        </button>
                    </div>
                </div>

                <!-- 套餐列表 -->
                <div class="space-y-3.5">
                    <div v-for="plan in plans" :key="plan.id" :class="['app-card relative p-5', plan.code === status?.plan?.code ? 'app-card-brand' : '']">
                        <div
                            v-if="plan.code === 'pro'"
                            class="bg-brand-gradient absolute -top-2.5 right-4 rounded-full px-2.5 py-0.5 text-[9px] font-extrabold tracking-wider uppercase"
                        >
                            {{ t('billing.hotBadge') }}
                        </div>
                        <div class="flex items-start justify-between">
                            <div class="min-w-0 pr-2">
                                <h3 class="text-base font-black">{{ plan.name }}</h3>
                                <p class="text-muted-2 mt-1 text-[11px] leading-relaxed">{{ plan.description }}</p>
                            </div>
                            <div class="shrink-0 text-right">
                                <span class="text-2xl font-black">
                                    ¥{{ formatYuan(period === 'monthly' ? plan.monthlyPriceCents : plan.yearlyPriceCents) }}
                                </span>
                                <p class="text-faint text-[10px]">{{ period === 'monthly' ? t('billing.perMonth') : t('billing.perYear') }}</p>
                            </div>
                        </div>

                        <div class="text-soft mt-3 flex items-center gap-1.5 text-[11px]">
                            <span class="text-brand font-bold">✓</span>
                            <span>{{ t('billing.dailyQuota') }}{{ t('common.colon') }}{{ plan.chatQuotaPerDay ?? t('billing.unlimited') }}</span>
                        </div>

                        <button
                            class="app-btn mt-4 w-full !py-3 transition-transform active:scale-[0.98]"
                            :class="
                                plan.code === status?.plan?.code && !status?.expiresAt
                                    ? 'app-btn-outline'
                                    : plan.monthlyPriceCents === 0
                                      ? 'app-btn-outline'
                                      : 'app-btn-primary'
                            "
                            :disabled="paying || isDisabledPlan(plan)"
                            @click="handleSubscribe(plan)"
                        >
                            {{ planActionLabel(plan) }}
                        </button>
                    </div>

                    <!-- 套餐空态：服务端返回 0 个启用套餐时不再静默空白 -->
                    <div v-if="!plans.length && !loading" class="app-empty">
                        <div class="app-empty-icon">💳</div>
                        <p class="app-empty-title">{{ t('billing.plansEmpty') }}</p>
                    </div>
                </div>

                <!-- 常见问题解答 FAQ -->
                <div class="app-card space-y-3 p-4">
                    <h3 class="flex items-center gap-1.5 text-sm font-black">
                        <span>❓</span>
                        <span>{{ t('billing.faqTitle') }}</span>
                    </h3>
                    <div class="space-y-2 text-xs">
                        <details class="group bg-surface-2 text-soft rounded-xl p-3 transition-colors open:!bg-[color:var(--surface-3)]">
                            <summary class="flex cursor-pointer list-none items-center justify-between font-bold select-none">
                                <span>{{ t('billing.faq1Q') }}</span>
                                <span class="text-[10px] transition-transform group-open:rotate-180">▼</span>
                            </summary>
                            <p class="text-faint mt-2 text-[11px] leading-relaxed">{{ t('billing.faq1A') }}</p>
                        </details>
                        <details class="group bg-surface-2 text-soft rounded-xl p-3 transition-colors open:!bg-[color:var(--surface-3)]">
                            <summary class="flex cursor-pointer list-none items-center justify-between font-bold select-none">
                                <span>{{ t('billing.faq2Q') }}</span>
                                <span class="text-[10px] transition-transform group-open:rotate-180">▼</span>
                            </summary>
                            <p class="text-faint mt-2 text-[11px] leading-relaxed">{{ t('billing.faq2A') }}</p>
                        </details>
                    </div>
                </div>

                <!-- 订单记录 -->
                <div class="app-card p-4">
                    <h3 class="text-sm font-black">{{ t('nav.orders') }}</h3>
                    <ul class="mt-3 space-y-3">
                        <li v-for="o in orders" :key="o.id" class="flex items-center justify-between text-xs">
                            <div class="min-w-0">
                                <p class="truncate font-semibold">
                                    {{ o.planCode }} · {{ o.period === 'yearly' ? t('billing.yearly') : t('billing.monthly') }}
                                </p>
                                <p class="text-faint mt-0.5 font-mono text-[10px]">{{ o.orderNo }}</p>
                            </div>
                            <div class="text-right">
                                <p class="font-black">¥{{ formatYuan(o.amountCents) }}</p>
                                <span :class="['app-badge mt-1', orderStatusTone(o.status)]">{{ t(orderStatusLabelKey(o.status)) }}</span>
                            </div>
                        </li>
                        <li v-if="!orders.length" class="text-faint py-6 text-center text-xs">{{ t('admin.tableEmpty') }}</li>
                    </ul>
                </div>
            </div>
        </ion-content>

        <!-- 支付弹层 -->
        <ion-modal :is-open="payModalOpen" @did-dismiss="closePayModal">
            <ion-header class="ion-no-border">
                <ion-toolbar>
                    <ion-title class="!text-sm font-black">{{ t('billing.payMethod') }}</ion-title>
                    <template v-slot:end>
                        <ion-buttons>
                            <button type="button" class="app-btn app-btn-ghost" :aria-label="t('common.close')" @click="closePayModal">✕</button>
                        </ion-buttons>
                    </template>
                </ion-toolbar>
            </ion-header>
            <ion-content class="ion-padding">
                <div class="text-center">
                    <template v-if="paySuccess">
                        <div class="text-brand mb-2 text-5xl">✓</div>
                        <h4 class="text-base font-bold">{{ t('billing.paySuccess') }}</h4>
                    </template>
                    <template v-else>
                        <p class="text-muted-2 text-xs">
                            {{ t('billing.orderNo') }}{{ t('common.colon') }}<span class="font-mono">{{ activeOrder?.orderNo }}</span>
                        </p>
                        <p class="mt-2 text-2xl font-black">¥{{ formatYuan(activeOrder?.amountCents) }}</p>

                        <div v-if="activeOrder?.mode === 'qrcode' && qrCodeDataUrl" class="mt-4 flex flex-col items-center">
                            <img
                                :src="qrCodeDataUrl"
                                :alt="t('billing.wechatPay')"
                                class="h-48 w-48 rounded-2xl border p-2"
                                style="border-color: var(--line)"
                            />
                            <p class="text-faint mt-2 text-xs">{{ t('billing.scanToPay') }}</p>
                        </div>

                        <div v-if="activeOrder?.mode === 'mock'" class="app-alert app-alert-warning mt-4 text-left">
                            <p class="text-xs font-bold">🛠️ {{ t('billing.mockPay') }}</p>
                            <button class="app-btn app-btn-soft mt-3 w-full" :disabled="mockPaying" @click="handleMockPay">
                                {{ mockPaying ? t('common.loading') : t('billing.mockPayConfirm') }}
                            </button>
                        </div>

                        <p v-if="payError" class="app-alert app-alert-danger mt-3">{{ payError }}</p>

                        <p class="text-faint mt-4 text-xs">⏳ {{ t('billing.paying') }}</p>
                    </template>
                </div>
            </ion-content>
        </ion-modal>
    </ion-page>
</template>
