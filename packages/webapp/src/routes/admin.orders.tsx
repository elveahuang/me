import { api } from '@/lib/client-api';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

interface AdminOrderRow {
    id: number;
    orderNo: string;
    userEmail: string | null;
    planCode: string;
    period: string;
    amountCents: number;
    status: string;
    provider: string;
    providerTradeNo: string | null;
    paidAt: string | null;
    createdAt: string;
}

const PERIOD_LABEL: Record<string, string> = { monthly: '按月', yearly: '按年' };
const STATUS_LABEL: Record<string, string> = { pending: '待支付', paid: '已支付', closed: '已关闭', refunded: '已退款' };
const PROVIDER_LABEL: Record<string, string> = { wechat: '微信支付', mock: '模拟支付' };

function formatDateTime(value: string | null) {
    if (!value) return '—';
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export const Route = createFileRoute('/admin/orders')({
    component: AdminOrdersPage,
});

function AdminOrdersPage() {
    const { data, isLoading } = useQuery({
        queryKey: ['admin', 'orders'],
        queryFn: () => api<{ orders: AdminOrderRow[] }>('/api/admin/orders'),
    });

    const orders = data?.orders ?? [];

    return (
        <div className='space-y-4'>
            <div>
                <h1 className='text-xl font-bold text-gray-900'>订单管理</h1>
                <p className='mt-1 text-sm text-gray-500'>全站支付订单（最近 200 条），金额以下单时套餐快照为准。</p>
            </div>

            <div className='overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm'>
                <table className='w-full text-sm'>
                    <thead className='bg-gray-50 text-left text-xs text-gray-500 uppercase'>
                        <tr>
                            <th className='px-4 py-3'>订单号</th>
                            <th className='px-4 py-3'>用户邮箱</th>
                            <th className='px-4 py-3'>套餐</th>
                            <th className='px-4 py-3'>周期</th>
                            <th className='px-4 py-3'>金额</th>
                            <th className='px-4 py-3'>状态</th>
                            <th className='px-4 py-3'>渠道</th>
                            <th className='px-4 py-3'>微信交易号</th>
                            <th className='px-4 py-3'>支付时间</th>
                            <th className='px-4 py-3'>创建时间</th>
                        </tr>
                    </thead>
                    <tbody className='divide-y divide-gray-100'>
                        {orders.map((order) => (
                            <tr key={order.id}>
                                <td className='px-4 py-3 font-mono text-xs text-gray-500'>{order.orderNo}</td>
                                <td className='px-4 py-3 text-gray-600'>{order.userEmail ?? '—'}</td>
                                <td className='px-4 py-3 text-gray-900'>{order.planCode}</td>
                                <td className='px-4 py-3 text-gray-600'>{PERIOD_LABEL[order.period] ?? order.period}</td>
                                <td className='px-4 py-3 text-gray-900'>¥{(order.amountCents / 100).toFixed(2)}</td>
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
                                        {STATUS_LABEL[order.status] ?? order.status}
                                    </span>
                                </td>
                                <td className='px-4 py-3 text-gray-600'>{PROVIDER_LABEL[order.provider] ?? order.provider}</td>
                                <td className='px-4 py-3 font-mono text-xs text-gray-500'>{order.providerTradeNo ?? '—'}</td>
                                <td className='px-4 py-3 text-gray-500'>{formatDateTime(order.paidAt)}</td>
                                <td className='px-4 py-3 text-gray-500'>{formatDateTime(order.createdAt)}</td>
                            </tr>
                        ))}
                        {!isLoading && orders.length === 0 ? (
                            <tr>
                                <td colSpan={10} className='px-4 py-8 text-center text-gray-400'>
                                    还没有订单
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
