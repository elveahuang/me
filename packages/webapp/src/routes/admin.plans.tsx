import { api } from '@/lib/client-api';
import { Button } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

interface AdminPlan {
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

const EMPTY_FORM = {
    code: '',
    name: '',
    description: '',
    chatQuotaPerDay: '',
    monthlyPriceCents: '0',
    yearlyPriceCents: '',
    enabled: true,
    sortOrder: '0',
};

export const Route = createFileRoute('/admin/plans')({
    component: AdminPlansPage,
});

function AdminPlansPage() {
    const queryClient = useQueryClient();
    const { data: plans = [], isLoading } = useQuery({
        queryKey: ['admin', 'plans'],
        queryFn: () => api<AdminPlan[]>('/api/admin/plans'),
    });

    const [editing, setEditing] = useState<AdminPlan | null>(null);
    const [creating, setCreating] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => api(`/api/admin/plans/${id}`, { method: 'DELETE' }),
        onSuccess: () => {
            setDeleteError(null);
            void invalidate();
        },
        onError: (err) => setDeleteError(err instanceof Error ? err.message : '删除失败'),
    });

    return (
        <div className='space-y-4'>
            <div className='flex items-center justify-between'>
                <div>
                    <h1 className='text-xl font-bold text-gray-900'>套餐管理</h1>
                    <p className='mt-1 text-sm text-gray-500'>会员套餐定义每日对话配额与价格；free 为注册用户的免费兜底档。</p>
                </div>
                <Button onPress={() => setCreating(true)}>+ 新建套餐</Button>
            </div>

            {deleteError ? <p className='text-sm text-red-600'>{deleteError}</p> : null}

            <div className='overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm'>
                <table className='w-full text-sm'>
                    <thead className='bg-gray-50 text-left text-xs text-gray-500 uppercase'>
                        <tr>
                            <th className='px-4 py-3'>ID</th>
                            <th className='px-4 py-3'>编码</th>
                            <th className='px-4 py-3'>套餐</th>
                            <th className='px-4 py-3'>每日配额</th>
                            <th className='px-4 py-3'>月价</th>
                            <th className='px-4 py-3'>年价</th>
                            <th className='px-4 py-3'>状态</th>
                            <th className='px-4 py-3'>排序</th>
                            <th className='px-4 py-3 text-right'>操作</th>
                        </tr>
                    </thead>
                    <tbody className='divide-y divide-gray-100'>
                        {plans.map((plan) => (
                            <tr key={plan.id}>
                                <td className='px-4 py-3 text-gray-400'>{plan.id}</td>
                                <td className='px-4 py-3 font-mono text-xs text-gray-500'>{plan.code}</td>
                                <td className='px-4 py-3'>
                                    <div className='font-medium text-gray-900'>{plan.name}</div>
                                    <div className='max-w-sm truncate text-xs text-gray-400'>{plan.description}</div>
                                </td>
                                <td className='px-4 py-3 text-gray-600'>{plan.chatQuotaPerDay ?? '∞'}</td>
                                <td className='px-4 py-3 text-gray-600'>¥{(plan.monthlyPriceCents / 100).toFixed(2)}</td>
                                <td className='px-4 py-3 text-gray-600'>
                                    {plan.yearlyPriceCents !== null ? `¥${(plan.yearlyPriceCents / 100).toFixed(2)}` : '—'}
                                </td>
                                <td className='px-4 py-3'>
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-xs ${
                                            plan.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                                        }`}
                                    >
                                        {plan.enabled ? '上架' : '下架'}
                                    </span>
                                </td>
                                <td className='px-4 py-3 text-gray-400'>{plan.sortOrder}</td>
                                <td className='px-4 py-3 text-right'>
                                    <Button size='sm' variant='ghost' onPress={() => setEditing(plan)}>
                                        编辑
                                    </Button>
                                    <Button
                                        size='sm'
                                        variant='ghost'
                                        className='text-red-500'
                                        onPress={() => {
                                            if (window.confirm(`确认删除套餐「${plan.name}」？`)) {
                                                deleteMutation.mutate(plan.id);
                                            }
                                        }}
                                    >
                                        删除
                                    </Button>
                                </td>
                            </tr>
                        ))}
                        {!isLoading && plans.length === 0 ? (
                            <tr>
                                <td colSpan={9} className='px-4 py-8 text-center text-gray-400'>
                                    还没有套餐，点击右上角创建
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            <PlanFormModal
                open={creating}
                plan={null}
                onClose={() => setCreating(false)}
                onSaved={() => {
                    setCreating(false);
                    void invalidate();
                }}
            />
            <PlanFormModal
                open={editing !== null}
                plan={editing}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    void invalidate();
                }}
            />
        </div>
    );
}

function PlanFormModal({ open, plan, onClose, onSaved }: { open: boolean; plan: AdminPlan | null; onClose: () => void; onSaved: () => void }) {
    const [form, setForm] = useState(EMPTY_FORM);
    const [formPlanId, setFormPlanId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const openKey = `${open}:${plan?.id ?? 'new'}`;
    const [lastKey, setLastKey] = useState('');
    if (openKey !== lastKey) {
        setLastKey(openKey);
        setForm(
            plan
                ? {
                      code: plan.code,
                      name: plan.name,
                      description: plan.description,
                      chatQuotaPerDay: plan.chatQuotaPerDay === null ? '' : String(plan.chatQuotaPerDay),
                      monthlyPriceCents: String(plan.monthlyPriceCents),
                      yearlyPriceCents: plan.yearlyPriceCents === null ? '' : String(plan.yearlyPriceCents),
                      enabled: plan.enabled,
                      sortOrder: String(plan.sortOrder),
                  }
                : EMPTY_FORM,
        );
        setFormPlanId(plan?.id ?? null);
        setError(null);
    }

    if (!open) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        const chatQuotaPerDay = form.chatQuotaPerDay.trim() === '' ? null : Number(form.chatQuotaPerDay);
        const monthlyPriceCents = Number(form.monthlyPriceCents || '0');
        const yearlyPriceCents = form.yearlyPriceCents.trim() === '' ? null : Number(form.yearlyPriceCents);
        const sortOrder = Number(form.sortOrder || '0');
        if (
            (chatQuotaPerDay !== null && !Number.isInteger(chatQuotaPerDay)) ||
            !Number.isInteger(monthlyPriceCents) ||
            (yearlyPriceCents !== null && !Number.isInteger(yearlyPriceCents)) ||
            !Number.isInteger(sortOrder)
        ) {
            setError('配额、价格与排序必须为整数');
            return;
        }

        setSaving(true);
        try {
            const body = JSON.stringify({
                code: form.code,
                name: form.name,
                description: form.description,
                chatQuotaPerDay,
                monthlyPriceCents,
                yearlyPriceCents,
                enabled: form.enabled,
                sortOrder,
            });
            if (formPlanId !== null) {
                await api(`/api/admin/plans/${formPlanId}`, { method: 'PATCH', body });
            } else {
                await api('/api/admin/plans', { method: 'POST', body });
            }
            onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : '保存失败');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={formPlanId !== null ? '编辑套餐' : '新建套餐'} onClose={onClose}>
            <form className='space-y-3' onSubmit={handleSubmit}>
                <div className='grid grid-cols-2 gap-3'>
                    <div>
                        <label className='mb-1 block text-xs font-medium text-gray-500'>
                            编码{formPlanId !== null ? '（创建后不可修改）' : '（如 free / pro / max）'}
                        </label>
                        <input
                            required
                            value={form.code}
                            disabled={formPlanId !== null}
                            onChange={(e) => setForm({ ...form, code: e.target.value })}
                            className={`${inputClass} disabled:bg-gray-100 disabled:text-gray-400`}
                            placeholder='pro'
                        />
                    </div>
                    <div>
                        <label className='mb-1 block text-xs font-medium text-gray-500'>名称</label>
                        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
                    </div>
                </div>
                <div>
                    <label className='mb-1 block text-xs font-medium text-gray-500'>描述</label>
                    <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
                </div>
                <div className='grid grid-cols-2 gap-3'>
                    <div>
                        <label className='mb-1 block text-xs font-medium text-gray-500'>每日对话配额（留空 = 不限）</label>
                        <input
                            type='number'
                            min={1}
                            value={form.chatQuotaPerDay}
                            onChange={(e) => setForm({ ...form, chatQuotaPerDay: e.target.value })}
                            className={inputClass}
                            placeholder='不限'
                        />
                    </div>
                    <div>
                        <label className='mb-1 block text-xs font-medium text-gray-500'>排序（越小越靠前）</label>
                        <input type='number' value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} className={inputClass} />
                    </div>
                </div>
                <div className='grid grid-cols-2 gap-3'>
                    <div>
                        <label className='mb-1 block text-xs font-medium text-gray-500'>月价（分）</label>
                        <input
                            type='number'
                            min={0}
                            required
                            value={form.monthlyPriceCents}
                            onChange={(e) => setForm({ ...form, monthlyPriceCents: e.target.value })}
                            className={inputClass}
                            placeholder='如 2900 = ¥29.00'
                        />
                    </div>
                    <div>
                        <label className='mb-1 block text-xs font-medium text-gray-500'>年价（分，留空 = 不支持按年）</label>
                        <input
                            type='number'
                            min={0}
                            value={form.yearlyPriceCents}
                            onChange={(e) => setForm({ ...form, yearlyPriceCents: e.target.value })}
                            className={inputClass}
                            placeholder='如 29000 = ¥290.00'
                        />
                    </div>
                </div>
                <label className='flex items-center gap-2 text-sm text-gray-700'>
                    <input type='checkbox' checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                    上架（用户可见可购买）
                </label>
                {error ? <p className='text-sm text-red-600'>{error}</p> : null}
                <div className='flex justify-end gap-2 pt-1'>
                    <Button type='button' variant='ghost' onPress={onClose}>
                        取消
                    </Button>
                    <Button type='submit' isDisabled={saving}>
                        {saving ? '保存中…' : '保存'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}

const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

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
