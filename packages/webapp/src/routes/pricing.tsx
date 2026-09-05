import type { SessionUser } from '@/components/app-header';
import { AppHeader } from '@/components/app-header';
import i18n from '@/i18n';
import { api } from '@/lib/client-api';
import { fetchSession } from '@/lib/session';
import { Button } from '@heroui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

interface CreateOrderResult {
    orderNo: string;
    status: 'pending' | 'paid' | 'closed';
    provider: string;
    mode: 'mock' | 'qrcode' | 'jsapi' | 'redirect';
    payUrl?: string | null;
    amountCents: number;
    planCode: string;
    period: 'monthly' | 'yearly';
}

interface OrderStatusResult {
    orderNo: string;
    status: 'pending' | 'paid' | 'closed' | 'refunded';
    mode: string | null;
    payUrl: string | null;
    amountCents: number;
}

interface OrderRow {
    id: number;
    orderNo: string;
    planCode: string;
    period: string;
    amountCents: number;
    status: string;
    provider: string;
    paidAt: string | null;
    createdAt: string;
}

const PERIOD_KEYS: Record<string, string> = { monthly: 'pricing.periodMonthly', yearly: 'pricing.periodYearly' };
const STATUS_KEYS: Record<string, string> = { pending: 'pricing.statusPending', paid: 'pricing.statusPaid', closed: 'pricing.statusClosed', refunded: 'pricing.statusRefunded' };
const PROVIDER_KEYS: Record<string, string> = { wechat: 'pricing.providerWechat', mock: 'pricing.providerMock' };

/** 枚举值 → 文案：命中映射表时走 i18n，否则原样展示原始值 */
function labelFor(t: TFunction, keys: Record<string, string>, value: string) {
    const key = keys[value];
    return key ? t(key) : value;
}

/** 金额展示：分 → 元（保留 2 位小数） */
function yuan(cents: number) {
    return (cents / 100).toFixed(2);
}

function formatDateTime(value: string | null) {
    if (!value) return '—';
    const locale = i18n.language?.startsWith('zh') ? 'zh-CN' : 'en-US';
    return new Date(value).toLocaleString(locale, { hour12: false });
}

export const Route = createFileRoute('/pricing')({
    beforeLoad: async () => {
        const session = await fetchSession();
        if (!session) throw redirect({ to: '/login', search: {} });
        return { session };
    },
    component: PricingPage,
});

function PricingPage() {
    const { t } = useTranslation();
    const { session } = Route.useRouteContext();
    const user = session.user as SessionUser;

    const { data: membership } = useQuery({
        queryKey: ['billing', 'membership'],
        queryFn: () => api<MembershipStatus>('/api/billing/membership'),
    });

    const { data: planData, isLoading: plansLoading } = useQuery({
        queryKey: ['plans'],
        queryFn: () => api<{ plans: Plan[]; providers: { code: string; available: boolean }[] }>('/api/plans'),
    });

    const { data: myOrders, isLoading: ordersLoading } = useQuery({
        queryKey: ['billing', 'orders'],
        queryFn: () => api<{ orders: OrderRow[] }>('/api/billing/orders'),
    });

    const plans = planData?.plans ?? [];
    const orders = myOrders?.orders ?? [];
    const currentPlanId = membership?.plan?.id ?? null;

    const [payModal, setPayModal] = useState<{ plan: Plan; period: 'monthly' | 'yearly'; order: CreateOrderResult } | null>(null);
    const [buying, setBuying] = useState<string | null>(null);
    const [orderError, setOrderError] = useState<string | null>(null);

    const handleBuy = async (plan: Plan, period: 'monthly' | 'yearly') => {
        setBuying(`${plan.id}:${period}`);
        setOrderError(null);
        try {
            const order = await api<CreateOrderResult>('/api/billing/orders', {
                method: 'POST',
                body: JSON.stringify({ planId: plan.id, period }),
            });
            setPayModal({ plan, period, order });
        } catch (err) {
            setOrderError(err instanceof Error ? err.message : t('pricing.orderErrorFallback'));
        } finally {
            setBuying(null);
        }
    };

    return (
        <div className='flex min-h-dvh flex-col bg-gray-50'>
            <AppHeader user={user} />
            <main className='mx-auto w-full max-w-5xl flex-1 space-y-6 p-6'>
                {/* 当前会员状态 */}
                <section className='rounded-2xl border border-gray-200 bg-white p-6 shadow-sm'>
                    <div className='flex flex-wrap items-center justify-between gap-4'>
                        <div>
                            <p className='text-sm text-gray-500'>{t('pricing.currentPlan')}</p>
                            <p className='mt-1 text-xl font-bold text-gray-900'>{membership?.plan?.name ?? t('pricing.noPlan')}</p>
                            <p className='mt-1 text-sm text-gray-500'>
                                {membership?.expiresAt
                                    ? t('pricing.expiresAt', { date: formatDateTime(membership.expiresAt) })
                                    : t('pricing.noActiveMembership')}
                            </p>
                        </div>
                        <div className='text-right'>
                            <p className='text-sm text-gray-500'>{t('pricing.todayUsage')}</p>
                            <p className='mt-1 text-xl font-bold text-gray-900'>
                                {membership ? membership.usedToday : '—'}
                                <span className='text-sm font-normal text-gray-400'> / {membership?.chatQuotaPerDay ?? '∞'}</span>
                            </p>
                        </div>
                    </div>
                </section>

                {/* 套餐列表 */}
                <section className='space-y-3'>
                    <div>
                        <h2 className='text-lg font-bold text-gray-900'>{t('pricing.choosePlan')}</h2>
                        {orderError ? <p className='mt-1 text-sm text-red-600'>{orderError}</p> : null}
                    </div>
                    <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
                        {plans.map((plan) => (
                            <PlanCard
                                key={plan.id}
                                plan={plan}
                                current={currentPlanId === plan.id}
                                buying={buying !== null}
                                onBuy={(period) => void handleBuy(plan, period)}
                            />
                        ))}
                        {!plansLoading && plans.length === 0 ? <p className='text-sm text-gray-400'>{t('pricing.noPlans')}</p> : null}
                    </div>
                </section>

                {/* 我的订单 */}
                <section className='space-y-3'>
                    <h2 className='text-lg font-bold text-gray-900'>{t('pricing.myOrders')}</h2>
                    <div className='overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm'>
                        <table className='w-full text-sm'>
                            <thead className='bg-gray-50 text-left text-xs text-gray-500 uppercase'>
                                <tr>
                                    <th className='px-4 py-3'>{t('pricing.orderNo')}</th>
                                    <th className='px-4 py-3'>{t('pricing.plan')}</th>
                                    <th className='px-4 py-3'>{t('pricing.period')}</th>
                                    <th className='px-4 py-3'>{t('pricing.amount')}</th>
                                    <th className='px-4 py-3'>{t('pricing.status')}</th>
                                    <th className='px-4 py-3'>{t('pricing.channel')}</th>
                                    <th className='px-4 py-3'>{t('pricing.paidAt')}</th>
                                </tr>
                            </thead>
                            <tbody className='divide-y divide-gray-100'>
                                {orders.map((order) => (
                                    <tr key={order.id}>
                                        <td className='px-4 py-3 font-mono text-xs text-gray-500'>{order.orderNo}</td>
                                        <td className='px-4 py-3 text-gray-900'>{order.planCode}</td>
                                        <td className='px-4 py-3 text-gray-600'>{labelFor(t, PERIOD_KEYS, order.period)}</td>
                                        <td className='px-4 py-3 text-gray-900'>¥{yuan(order.amountCents)}</td>
                                        <td className='px-4 py-3'>
                                            <span
                                                className={`rounded-full px-2 py-0.5 text-xs ${
                                                    order.status === 'paid'
                                                        ? 'bg-emerald-100 text-emerald-700'
                                                        : order.status === 'pending'
                                                          ? 'bg-amber-100 text-amber-700'
                                                          : 'bg-gray-100 text-gray-500'
                                                }`}
                                            >
                                                {labelFor(t, STATUS_KEYS, order.status)}
                                            </span>
                                        </td>
                                        <td className='px-4 py-3 text-gray-600'>{labelFor(t, PROVIDER_KEYS, order.provider)}</td>
                                        <td className='px-4 py-3 text-gray-500'>{formatDateTime(order.paidAt)}</td>
                                    </tr>
                                ))}
                                {!ordersLoading && orders.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className='px-4 py-8 text-center text-gray-400'>
                                            {t('pricing.noOrders')}
                                        </td>
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>
                </section>
            </main>

            {payModal ? <PayModal payModal={payModal} onClose={() => setPayModal(null)} /> : null}
        </div>
    );
}

function PlanCard({ plan, current, buying, onBuy }: { plan: Plan; current: boolean; buying: boolean; onBuy: (period: 'monthly' | 'yearly') => void }) {
    const { t } = useTranslation();
    const isFree = plan.code === 'free' || plan.monthlyPriceCents === 0;

    return (
        <div
            className={`flex flex-col rounded-2xl border bg-white p-5 shadow-sm ${
                current ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'
            }`}
        >
            <div className='flex items-center justify-between'>
                <h3 className='text-base font-bold text-gray-900'>{plan.name}</h3>
                {current ? <span className='rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600'>{t('pricing.currentPlan')}</span> : null}
            </div>
            <p className='mt-1 min-h-10 text-sm text-gray-500'>{plan.description}</p>
            <div className='mt-3 text-2xl font-bold text-gray-900'>
                ¥{yuan(plan.monthlyPriceCents)}
                <span className='text-sm font-normal text-gray-400'>{t('pricing.perMonth')}</span>
            </div>
            <div className='mt-1 text-sm text-gray-500'>
                {plan.yearlyPriceCents !== null ? (
                    <>
                        ¥{yuan(plan.yearlyPriceCents)}
                        <span className='text-gray-400'>{t('pricing.perYear')}</span>
                    </>
                ) : (
                    '—'
                )}
            </div>
            <div className='mt-3 text-sm text-gray-500'>
                {t('pricing.dailyQuota')}
                <span className='font-medium text-gray-900'>{plan.chatQuotaPerDay ?? '∞'}</span>
            </div>
            <div className='mt-4 flex gap-2 pt-1'>
                {isFree ? (
                    <span className='flex-1 rounded-lg bg-gray-100 px-3 py-2 text-center text-sm text-gray-400'>{t('pricing.freeTier')}</span>
                ) : (
                    <>
                        <Button size='sm' isDisabled={buying} onPress={() => onBuy('monthly')} className='flex-1'>
                            {buying ? t('pricing.ordering') : t('pricing.buyMonthly')}
                        </Button>
                        <Button
                            size='sm'
                            variant='ghost'
                            isDisabled={buying || plan.yearlyPriceCents === null}
                            onPress={() => onBuy('yearly')}
                            className='flex-1'
                        >
                            {t('pricing.buyYearly')}
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}

function PayModal({
    payModal,
    onClose,
}: {
    payModal: { plan: Plan; period: 'monthly' | 'yearly'; order: CreateOrderResult };
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const { plan, period, order } = payModal;
    const [mockPaying, setMockPaying] = useState(false);
    const [payError, setPayError] = useState<string | null>(null);
    const refreshedRef = useRef(false);

    // 待支付订单每 2 秒轮询一次；Modal 关闭（组件卸载）后自动停止
    const { data: latest } = useQuery({
        queryKey: ['billing', 'order', order.orderNo],
        queryFn: () => api<OrderStatusResult>(`/api/billing/orders/${order.orderNo}`),
        refetchInterval: 2000,
    });

    const status = latest?.status ?? order.status;
    const mode = latest?.mode ?? order.mode;

    // 支付成功后刷新会员状态与订单列表（只触发一次）
    useEffect(() => {
        if (status === 'paid' && !refreshedRef.current) {
            refreshedRef.current = true;
            void queryClient.invalidateQueries({ queryKey: ['billing'] });
        }
    }, [status, queryClient]);

    const handleMockPay = async () => {
        setMockPaying(true);
        setPayError(null);
        try {
            await api(`/api/billing/orders/${order.orderNo}/mock-pay`, { method: 'POST' });
            await queryClient.invalidateQueries({ queryKey: ['billing', 'order', order.orderNo] });
        } catch (err) {
            setPayError(err instanceof Error ? err.message : t('pricing.payErrorFallback'));
        } finally {
            setMockPaying(false);
        }
    };

    return (
        <Modal title={t('pricing.checkout')} onClose={onClose}>
            <div className='space-y-4'>
                <div className='space-y-2 rounded-xl bg-gray-50 p-4 text-sm'>
                    <div className='flex justify-between'>
                        <span className='text-gray-500'>{t('pricing.plan')}</span>
                        <span className='font-medium text-gray-900'>
                            {t('pricing.planWithPeriod', { plan: plan.name, period: labelFor(t, PERIOD_KEYS, period) })}
                        </span>
                    </div>
                    <div className='flex justify-between'>
                        <span className='text-gray-500'>{t('pricing.orderNo')}</span>
                        <span className='font-mono text-xs text-gray-600'>{order.orderNo}</span>
                    </div>
                    <div className='flex justify-between'>
                        <span className='text-gray-500'>{t('pricing.amount')}</span>
                        <span className='text-lg font-bold text-gray-900'>¥{yuan(order.amountCents)}</span>
                    </div>
                </div>

                {status === 'paid' ? (
                    <div className='rounded-xl bg-emerald-50 p-4 text-center'>
                        <p className='text-lg font-bold text-emerald-600'>{t('pricing.paySuccess')}</p>
                        <p className='mt-1 text-sm text-emerald-700'>{t('pricing.membershipActive')}</p>
                    </div>
                ) : status === 'closed' ? (
                    <div className='rounded-xl bg-gray-100 p-4 text-center text-sm text-gray-500'>{t('pricing.orderClosed')}</div>
                ) : mode === 'mock' ? (
                    <div className='space-y-3 text-center'>
                        <p className='rounded-xl bg-amber-50 p-3 text-sm text-amber-700'>{t('pricing.mockNotice')}</p>
                        <Button isDisabled={mockPaying} onPress={() => void handleMockPay()}>
                            {mockPaying ? t('pricing.paying') : t('pricing.mockPayButton')}
                        </Button>
                        <p className='text-xs text-gray-400'>{t('pricing.waitingResult')}</p>
                    </div>
                ) : mode === 'qrcode' ? (
                    <div className='space-y-3 text-center'>
                        <p className='text-sm text-gray-600'>{t('pricing.scanQr')}</p>
                        {order.payUrl ? (
                            <div className='flex justify-center rounded-xl border border-gray-200 p-3'>
                                <QRCodeSVG value={order.payUrl} size={180} />
                            </div>
                        ) : (
                            <p className='text-sm text-red-600'>{t('pricing.noQr')}</p>
                        )}
                        <p className='text-xs text-gray-400'>{t('pricing.autoConfirm')}</p>
                    </div>
                ) : mode === 'jsapi' ? (
                    <div className='space-y-3 text-center'>
                        <p className='rounded-xl bg-blue-50 p-3 text-sm text-blue-700'>{t('pricing.payInWechat')}</p>
                        <p className='text-xs text-gray-400'>{t('pricing.autoConfirm')}</p>
                    </div>
                ) : (
                    <div className='space-y-3 text-center'>
                        <p className='text-sm text-gray-600'>{t('pricing.payNewPage')}</p>
                        {order.payUrl ? (
                            <a href={order.payUrl} target='_blank' rel='noreferrer' className='text-sm font-medium text-blue-600 hover:underline'>
                                {t('pricing.openPayPage')}
                            </a>
                        ) : null}
                        <p className='text-xs text-gray-400'>{t('pricing.autoConfirm')}</p>
                    </div>
                )}

                {payError ? <p className='text-sm text-red-600'>{payError}</p> : null}
            </div>
        </Modal>
    );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
    return (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4' onClick={onClose}>
            <div className='max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl' onClick={(e) => e.stopPropagation()}>
                <div className='mb-4 flex items-center justify-between'>
                    <h2 className='text-lg font-bold text-gray-900'>{title}</h2>
                    <button type='button' onClick={onClose} className='text-gray-400 hover:text-gray-600'>
                        ✕
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}
