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
    type Plan,
    type PlansResponse,
} from '@commons/contract';
import {
    IonBackButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonModal,
    IonPage,
    IonRefresher,
    IonRefresherContent,
    IonTitle,
    IonToolbar,
    onIonViewWillEnter,
} from '@ionic/vue';
import QRCode from 'qrcode';
import { computed, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, extractApiError as extractError } from '../api/auth';

const { t } = useI18n();

const status = ref<MembershipStatus | null>(null);
const plans = ref<Plan[]>([]);
const orders = ref<OrderRecord[]>([]);
const period = ref<'monthly' | 'yearly'>('monthly');
const loading = ref(false);
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

async function loadData() {
    loading.value = true;
    loadError.value = '';
    try {
        const [sRes, pRes, oRes] = await Promise.all([
            api<MembershipStatus>('/api/billing/membership'),
            api<PlansResponse>('/api/plans'),
            api<{ orders: OrderRecord[] }>('/api/billing/orders'),
        ]);
        status.value = sRes;
        plans.value = pRes.plans.filter((p) => p.enabled);
        orders.value = oRes.orders;
    } catch (e) {
        loadError.value = extractError(e, t('common.error'));
    } finally {
        loading.value = false;
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

function startPolling(orderNo: string) {
    stopPolling();
    pollAttempts = 0;
    pollingTimer.value = window.setInterval(async () => {
        pollAttempts += 1;
        if (pollAttempts > POLL_MAX_ATTEMPTS) {
            stopPolling();
            payError.value = t('billing.pollTimeout');
            return;
        }
        try {
            const data = await api<{ status: string }>(`/api/billing/orders/${orderNo}`);
            if (data.status === 'paid') {
                stopPolling();
                paySuccess.value = true;
                scheduleAutoClose();
            } else if (data.status === 'closed') {
                stopPolling();
                payError.value = t('billing.payFailed');
            }
        } catch {
            // 轮询失败继续重试
        }
    }, 2000);
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
            qrCodeDataUrl.value = await QRCode.toDataURL(res.payUrl, { width: 220, margin: 1 });
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
        await api(`/api/billing/orders/${activeOrder.value.orderNo}/mock-pay`, { method: 'POST' });
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
</script>

<template>
    <ion-page>
        <ion-header class="ion-no-border">
            <ion-toolbar>
                <template v-slot:start>
                    <ion-buttons>
                        <ion-back-button default-href="/tabs/me" text="" />
                    </ion-buttons>
                </template>
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
                                <span class="app-chip !border-white/30 !bg-white/15 !text-white">
                                    {{ status?.expiresAt ? t('common.enabled') : t('billing.freePlan') }}
                                </span>
                                <h2 class="mt-2 text-xl font-black">{{ status?.plan?.name || t('billing.freePlan') }}</h2>
                            </div>
                            <div class="text-3xl">👑</div>
                        </div>

                        <div class="mt-4 space-y-2 border-t border-white/20 pt-3 text-xs opacity-95">
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
                            <div v-if="status?.chatQuotaPerDay" class="app-progress !bg-white/25">
                                <div class="app-progress-bar" :style="{ width: `${usedPercent}%`, backgroundColor: '#fff' }" />
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 周期切换 -->
                <div class="flex justify-center">
                    <div class="app-panel inline-flex gap-1 p-1.5">
                        <button :class="['app-btn', period === 'monthly' ? 'app-btn-soft' : 'app-btn-ghost']" @click="period = 'monthly'">
                            {{ t('billing.monthly') }}
                        </button>
                        <button :class="['app-btn', period === 'yearly' ? 'app-btn-soft' : 'app-btn-ghost']" @click="period = 'yearly'">
                            <span>{{ t('billing.yearly') }}</span>
                            <span class="app-chip app-chip-brand !text-[9px]">-20%</span>
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
                            HOT
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
                            <span>{{ t('billing.dailyQuota') }}：{{ plan.chatQuotaPerDay ?? t('billing.unlimited') }}</span>
                        </div>

                        <button
                            class="app-btn mt-4 w-full !py-3 transition-transform active:scale-[0.98]"
                            :class="plan.code === status?.plan?.code ? 'app-btn-outline' : plan.monthlyPriceCents === 0 ? 'app-btn-outline' : 'app-btn-primary'"
                            :disabled="paying || plan.code === status?.plan?.code"
                            @click="handleSubscribe(plan)"
                        >
                            {{
                                plan.code === status?.plan?.code
                                    ? t('billing.currentPlan')
                                    : plan.monthlyPriceCents === 0
                                      ? t('billing.freePlan')
                                      : t('billing.buyNow')
                            }}
                        </button>
                    </div>
                </div>

                <!-- 常见问题解答 FAQ -->
                <div class="app-card space-y-3 p-4">
                    <h3 class="flex items-center gap-1.5 text-sm font-black">
                        <span>❓</span>
                        <span>{{ t('billing.faqTitle') }}</span>
                    </h3>
                    <div class="space-y-2 text-xs">
                        <details class="group bg-surface-2 text-soft open:bg-surface-3 rounded-xl p-3 transition-colors">
                            <summary class="flex cursor-pointer list-none items-center justify-between font-bold select-none">
                                <span>{{ t('billing.faq1Q') }}</span>
                                <span class="text-[10px] transition-transform group-open:rotate-180">▼</span>
                            </summary>
                            <p class="text-faint mt-2 text-[11px] leading-relaxed">{{ t('billing.faq1A') }}</p>
                        </details>
                        <details class="group bg-surface-2 text-soft open:bg-surface-3 rounded-xl p-3 transition-colors">
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
                            <button type="button" class="app-btn app-btn-ghost" @click="closePayModal">✕</button>
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
                            {{ t('billing.orderNo') }}：<span class="font-mono">{{ activeOrder?.orderNo }}</span>
                        </p>
                        <p class="mt-2 text-2xl font-black">¥{{ formatYuan(activeOrder?.amountCents) }}</p>

                        <div v-if="activeOrder?.mode === 'qrcode' && qrCodeDataUrl" class="mt-4 flex flex-col items-center">
                            <img :src="qrCodeDataUrl" alt="WeChat Pay QR" class="h-48 w-48 rounded-2xl border p-2" style="border-color: var(--line)" />
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
