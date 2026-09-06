import {
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonItem,
    IonLabel,
    IonList,
    IonPage,
    IonTitle,
    IonToolbar,
    useIonToast,
} from '@ionic/react';
import { QRCodeSVG } from 'qrcode.react';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

interface Plan {
    id: number;
    code: string;
    name: string;
    description: string;
    chatQuotaPerDay: number | null;
    monthlyPriceCents: number;
    yearlyPriceCents: number | null;
    enabled: boolean;
    sortOrder: number;
}

interface MembershipStatus {
    plan: Plan | null;
    expiresAt: string | null;
    chatQuotaPerDay: number | null;
    usedToday: number;
}

interface OrderRecord {
    orderNo: string;
    planCode: string;
    period: string;
    amountCents: number;
    status: string;
    createdAt: string;
}

interface CreateOrderResult {
    orderNo: string;
    status: string;
    mode: 'mock' | 'qrcode' | 'jsapi' | 'redirect';
    payUrl?: string | null;
    jsapiParams?: {
        appId: string;
        timeStamp: string;
        nonceStr: string;
        package: string;
        signType: 'RSA';
        paySign: string;
    };
    amountCents: number;
    planCode: string;
    period: string;
}

/** H5 跳转支付后整页导航会丢失 React state；用 sessionStorage 保存待支付订单，返回本页时恢复轮询 */
const PENDING_ORDER_KEY = 'membership.payingOrder';

const ORDER_STATUS_COLOR: Record<string, string> = {
    pending: 'var(--ion-color-warning-shade, #c48400)',
    paid: 'var(--ion-color-success)',
    closed: 'var(--ion-color-medium)',
    refunded: 'var(--ion-color-medium)',
};

/** 分 → 元，保留两位小数 */
function formatYuan(cents: number): string {
    return (cents / 100).toFixed(2);
}

function formatTime(iso: string | null | undefined): string {
    if (!iso) return '-';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

const cardStyle: CSSProperties = {
    background: 'white',
    border: '1px solid var(--ion-color-light-shade, #d7d8da)',
    borderRadius: 14,
    padding: 14,
};

const tagStyle: CSSProperties = {
    fontSize: 11,
    lineHeight: '18px',
    padding: '0 8px',
    borderRadius: 999,
    background: 'var(--ion-color-primary-tint, #4d8dff)',
    color: 'white',
    whiteSpace: 'nowrap',
};

export function MembershipPage() {
    const { token } = useAuth();
    const { t } = useTranslation();
    const [presentToast] = useIonToast();

    const [membership, setMembership] = useState<MembershipStatus | null>(null);
    const [plans, setPlans] = useState<Plan[]>([]);
    const [orders, setOrders] = useState<OrderRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [payingOrder, setPayingOrderState] = useState<CreateOrderResult | null>(null);
    const jsapiInvokedRef = useRef(false);

    /** 更新待支付订单并同步到 sessionStorage（H5 跳转返回后恢复轮询） */
    const setPayingOrder = useCallback((order: CreateOrderResult | null) => {
        setPayingOrderState(order);
        try {
            if (order) sessionStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(order));
            else sessionStorage.removeItem(PENDING_ORDER_KEY);
        } catch {
            // sessionStorage 不可用时静默（仅影响跳转返回后的轮询恢复）
        }
    }, []);

    const refreshMembership = useCallback(async () => {
        if (token === null) return;
        try {
            setMembership(await api<MembershipStatus>('/api/billing/membership', token));
        } catch {
            // 状态刷新失败不阻塞页面
        }
    }, [token]);

    const refreshOrders = useCallback(async () => {
        if (token === null) return;
        try {
            const data = await api<{ orders: OrderRecord[] }>('/api/billing/orders', token);
            setOrders(data.orders);
        } catch {
            // 订单列表刷新失败不阻塞页面
        }
    }, [token]);

    const refreshAll = useCallback(() => {
        void refreshMembership();
        void refreshOrders();
    }, [refreshMembership, refreshOrders]);

    // 首次加载：套餐 + 会员状态 + 我的订单；并恢复 H5 跳转前的待支付订单（继续轮询）
    useEffect(() => {
        try {
            const saved = sessionStorage.getItem(PENDING_ORDER_KEY);
            if (saved) {
                const restored = JSON.parse(saved) as CreateOrderResult;
                if (restored?.orderNo && restored.status === 'pending') setPayingOrderState(restored);
                else sessionStorage.removeItem(PENDING_ORDER_KEY);
            }
        } catch {
            sessionStorage.removeItem(PENDING_ORDER_KEY);
        }
        if (token === null) return;
        (async () => {
            try {
                const [planData, membershipData, orderData] = await Promise.all([
                    api<{ plans: Plan[] }>('/api/plans', token),
                    api<MembershipStatus>('/api/billing/membership', token),
                    api<{ orders: OrderRecord[] }>('/api/billing/orders', token),
                ]);
                setPlans(planData.plans);
                setMembership(membershipData);
                setOrders(orderData.orders);
            } catch (e) {
                setError(e instanceof Error ? e.message : t('common.loadFailed'));
            } finally {
                setLoading(false);
            }
        })();
    }, [token, t, setPayingOrderState]);

    // JSAPI（微信内公众号支付）：拉起 WeixinJSBridge 收银台（幂等，仅一次）
    useEffect(() => {
        if (payingOrder?.mode !== 'jsapi' || jsapiInvokedRef.current) return;
        const invoke = () => {
            const bridge = (window as { WeixinJSBridge?: { invoke: (api: string, params: string, cb: (res: { err_msg?: string }) => void) => void } })
                .WeixinJSBridge;
            if (!bridge || !payingOrder.jsapiParams) return;
            jsapiInvokedRef.current = true;
            bridge.invoke('getBrandWCPayRequest', JSON.stringify(payingOrder.jsapiParams), (res) => {
                if (res?.err_msg && !res.err_msg.includes('ok')) {
                    console.warn('[pay] JSAPI 拉起失败:', res.err_msg);
                }
            });
        };
        if ((window as { WeixinJSBridge?: unknown }).WeixinJSBridge) {
            invoke();
        } else {
            // 微信浏览器异步注入 bridge：就绪事件触发后拉起
            document.addEventListener('WeixinJSBridgeReady', invoke, { once: true });
        }
    }, [payingOrder]);

    // 扫码/微信内/H5 跳转支付：每 2 秒轮询订单状态，离开页面时 cleanup 清理
    useEffect(() => {
        if (!payingOrder || (payingOrder.mode !== 'qrcode' && payingOrder.mode !== 'jsapi' && payingOrder.mode !== 'redirect')) return;
        const orderNo = payingOrder.orderNo;
        const timer = setInterval(() => {
            void (async () => {
                if (token === null) return;
                try {
                    const detail = await api<{ status: string }>(`/api/billing/orders/${orderNo}`, token);
                    if (detail.status === 'paid') {
                        setPayingOrder(null);
                        void presentToast({ message: t('membership.paySuccess'), duration: 2500, color: 'success' });
                        refreshAll();
                    } else if (detail.status === 'closed') {
                        setPayingOrder(null);
                        void presentToast({ message: t('membership.orderClosed'), duration: 2500, color: 'warning' });
                        void refreshOrders();
                    }
                } catch {
                    // 单次查询失败忽略，等待下一轮
                }
            })();
        }, 2000);
        return () => clearInterval(timer);
    }, [payingOrder, token, presentToast, refreshAll, refreshOrders, t]);

    const handleBuy = async (plan: Plan, period: 'monthly' | 'yearly') => {
        if (token === null || creating) return;
        setCreating(true);
        try {
            const order = await api<CreateOrderResult>('/api/billing/orders', token, {
                method: 'POST',
                body: JSON.stringify({ planId: plan.id, period }),
            });
            if (order.mode === 'mock') {
                // 开发环境模拟支付：直接置为已支付
                const pay = await api<{ ok: boolean; status: string }>(`/api/billing/orders/${order.orderNo}/mock-pay`, token, {
                    method: 'POST',
                });
                if (pay.status === 'paid') {
                    void presentToast({ message: t('membership.paySuccess'), duration: 2500, color: 'success' });
                } else {
                    void presentToast({ message: t('membership.mockPayAbnormal'), duration: 2500, color: 'warning' });
                }
                refreshAll();
            } else if (order.mode === 'redirect' && order.payUrl) {
                // H5 支付：跳转微信 App 完成支付，返回后进入轮询面板等待结果
                setPayingOrder(order);
                window.location.href = order.payUrl;
            } else {
                // qrcode / jsapi：展示支付引导并轮询订单状态
                setPayingOrder(order);
            }
        } catch (e) {
            void presentToast({ message: e instanceof Error ? e.message : t('membership.orderFailed'), duration: 2500, color: 'danger' });
        } finally {
            setCreating(false);
        }
    };

    const currentPlan = membership?.plan ?? null;
    const quota = membership?.chatQuotaPerDay ?? null;

    /** 订单状态文案映射 */
    const orderStatusText = (status: string): string => {
        switch (status) {
            case 'pending':
                return t('membership.statusPending');
            case 'paid':
                return t('membership.statusPaid');
            case 'closed':
                return t('membership.statusClosed');
            case 'refunded':
                return t('membership.statusRefunded');
            default:
                return status;
        }
    };

    return (
        <IonPage>
            <IonHeader>
                <IonToolbar>
                    <IonButtons slot='start'>
                        <IonBackButton defaultHref='/agents' />
                    </IonButtons>
                    <IonTitle>{t('common.membership')}</IonTitle>
                </IonToolbar>
            </IonHeader>
            <IonContent>
                {loading ? (
                    <p style={{ textAlign: 'center', padding: 32, color: 'var(--ion-color-medium)' }}>{t('common.loading')}</p>
                ) : error ? (
                    <p style={{ textAlign: 'center', padding: 32, color: 'var(--ion-color-danger)' }}>{error}</p>
                ) : (
                    <>
                        <div style={{ padding: '12px 12px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {/* 当前会员状态 */}
                            <div
                                style={{
                                    borderRadius: 14,
                                    padding: 16,
                                    background: 'linear-gradient(135deg, var(--ion-color-primary, #3880ff), var(--ion-color-primary-shade, #3171e0))',
                                    color: 'white',
                                }}
                            >
                                <p style={{ margin: 0, fontSize: 12, opacity: 0.85 }}>{t('membership.currentPlan')}</p>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '4px 0 10px' }}>
                                    <span style={{ fontSize: 20, fontWeight: 700 }}>{currentPlan ? currentPlan.name : t('membership.noPlan')}</span>
                                    {currentPlan && currentPlan.code === 'free' ? (
                                        <span style={{ ...tagStyle, background: 'rgba(255,255,255,0.25)' }}>{t('membership.freeTierTag')}</span>
                                    ) : null}
                                </div>
                                <p style={{ margin: 0, fontSize: 13 }}>
                                    {t('membership.expiresAt', {
                                        date: membership?.expiresAt ? new Date(membership.expiresAt).toLocaleDateString() : t('membership.neverExpires'),
                                    })}
                                </p>
                                <p style={{ margin: '4px 0 0', fontSize: 13 }}>
                                    {t('membership.usage', { used: membership ? membership.usedToday : 0, quota: quota === null ? '∞' : quota })}
                                </p>
                            </div>

                            {/* 支付引导（H5 跳转 / 扫码 / 微信内支付） */}
                            {payingOrder ? (
                                <div style={{ ...cardStyle, borderColor: 'var(--ion-color-primary, #3880ff)' }}>
                                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
                                        {payingOrder.mode === 'qrcode'
                                            ? t('membership.qrcodePayTitle')
                                            : payingOrder.mode === 'redirect'
                                              ? t('membership.redirectPayTitle')
                                              : t('membership.jsapiPayTitle')}
                                    </div>
                                    {payingOrder.mode === 'qrcode' ? (
                                        payingOrder.payUrl ? (
                                            <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0', background: 'white', borderRadius: 8 }}>
                                                <QRCodeSVG value={payingOrder.payUrl} size={160} />
                                            </div>
                                        ) : (
                                            <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--ion-color-danger)' }}>{t('membership.noPayUrl')}</p>
                                        )
                                    ) : payingOrder.mode === 'redirect' ? (
                                        <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--ion-color-medium)' }}>{t('membership.redirectPayHint')}</p>
                                    ) : (
                                        <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--ion-color-medium)' }}>{t('membership.jsapiPayHint')}</p>
                                    )}
                                    {payingOrder.mode === 'redirect' && payingOrder.payUrl ? (
                                        <IonButton size='small' style={{ marginTop: 4 }} onClick={() => (window.location.href = payingOrder.payUrl!)}>
                                            {t('membership.redirectPayButton')}
                                        </IonButton>
                                    ) : null}
                                    <p style={{ margin: 0, fontSize: 13, color: 'var(--ion-color-medium)' }}>
                                        {t('membership.pendingAmount', { amount: formatYuan(payingOrder.amountCents) })}
                                    </p>
                                    <IonButton size='small' fill='outline' style={{ marginTop: 10 }} onClick={() => setPayingOrder(null)}>
                                        {t('membership.cancelPay')}
                                    </IonButton>
                                </div>
                            ) : null}

                            {/* 套餐列表 */}
                            <h2 style={{ margin: '4px 4px -4px', fontSize: 16 }}>{t('membership.plansTitle')}</h2>
                            {plans.map((plan) => {
                                const isFree = plan.code === 'free';
                                const isCurrent = currentPlan?.id === plan.id;
                                return (
                                    <div key={plan.id} style={cardStyle}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 17, fontWeight: 700 }}>{plan.name}</span>
                                            {isFree ? <span style={tagStyle}>{t('membership.freeTierTag')}</span> : null}
                                            {isCurrent && !isFree ? <span style={tagStyle}>{t('membership.currentPlan')}</span> : null}
                                        </div>
                                        {plan.description ? (
                                            <p style={{ margin: '6px 0', fontSize: 13, color: 'var(--ion-color-medium)' }}>{plan.description}</p>
                                        ) : null}
                                        <p style={{ margin: '6px 0', fontSize: 13, color: 'var(--ion-color-medium)' }}>
                                            {t('membership.dailyQuota', {
                                                quota:
                                                    plan.chatQuotaPerDay === null
                                                        ? t('membership.unlimited')
                                                        : t('membership.quotaTimes', { n: plan.chatQuotaPerDay }),
                                            })}
                                        </p>
                                        {isFree ? (
                                            <p style={{ margin: '8px 0 0', fontSize: 15, fontWeight: 600 }}>{t('membership.free')}</p>
                                        ) : (
                                            <>
                                                <p style={{ margin: '8px 0', fontSize: 15, fontWeight: 600 }}>
                                                    {t('membership.priceMonthly', { price: formatYuan(plan.monthlyPriceCents) })}
                                                    {plan.yearlyPriceCents !== null
                                                        ? t('membership.priceYearly', { price: formatYuan(plan.yearlyPriceCents) })
                                                        : ''}
                                                </p>
                                                <div style={{ display: 'flex', gap: 8 }}>
                                                    <IonButton size='small' disabled={creating} onClick={() => void handleBuy(plan, 'monthly')}>
                                                        {t('membership.buyMonthly')}
                                                    </IonButton>
                                                    <IonButton
                                                        size='small'
                                                        fill='outline'
                                                        disabled={creating || !plan.yearlyPriceCents}
                                                        onClick={() => void handleBuy(plan, 'yearly')}
                                                    >
                                                        {t('membership.buyYearly')}
                                                    </IonButton>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                            {plans.length === 0 ? (
                                <p style={{ textAlign: 'center', padding: 16, color: 'var(--ion-color-medium)' }}>{t('membership.noPlans')}</p>
                            ) : null}
                        </div>

                        {/* 我的订单 */}
                        <div style={{ padding: '16px 12px 4px' }}>
                            <h2 style={{ margin: '0 4px', fontSize: 16 }}>{t('membership.ordersTitle')}</h2>
                        </div>
                        <IonList inset>
                            {orders.map((order) => (
                                <IonItem key={order.orderNo}>
                                    <IonLabel>
                                        <h2>
                                            {order.planCode} · {order.period === 'yearly' ? t('membership.periodYearly') : t('membership.periodMonthly')} · ¥
                                            {formatYuan(order.amountCents)}
                                        </h2>
                                        <p>{order.orderNo}</p>
                                        <p>{formatTime(order.createdAt)}</p>
                                    </IonLabel>
                                    <span
                                        slot='end'
                                        style={{ fontSize: 13, fontWeight: 600, color: ORDER_STATUS_COLOR[order.status] ?? 'var(--ion-color-medium)' }}
                                    >
                                        {orderStatusText(order.status)}
                                    </span>
                                </IonItem>
                            ))}
                            {orders.length === 0 ? (
                                <IonItem lines='none'>
                                    <IonLabel color='medium'>{t('membership.noOrders')}</IonLabel>
                                </IonItem>
                            ) : null}
                        </IonList>
                    </>
                )}
            </IonContent>
        </IonPage>
    );
}
