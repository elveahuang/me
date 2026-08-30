import { Button } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '@/lib/client-api';

interface AdminProvider {
    id: number;
    name: string;
    protocol: 'openai-compatible' | 'deepseek';
    baseUrl: string;
    apiKey: string;
    hasKey: boolean;
    embeddingModel: string | null;
    enabled: boolean;
}

const EMPTY_FORM = {
    name: '',
    protocol: 'openai-compatible' as AdminProvider['protocol'],
    baseUrl: '',
    apiKey: '',
    embeddingModel: '',
    enabled: true,
};

const inputClass =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

export const Route = createFileRoute('/admin/providers')({
    component: AdminProvidersPage,
});

function AdminProvidersPage() {
    const queryClient = useQueryClient();
    const { data: providers = [], isLoading } = useQuery({
        queryKey: ['admin', 'providers'],
        queryFn: () => api<AdminProvider[]>('/api/admin/providers'),
    });

    const [editing, setEditing] = useState<AdminProvider | null>(null);
    const [creating, setCreating] = useState(false);

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'providers'] });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => api(`/api/admin/providers/${id}`, { method: 'DELETE' }),
        onSuccess: invalidate,
    });

    return (
        <div className='space-y-4'>
            <div className='flex items-center justify-between'>
                <div>
                    <h1 className='text-xl font-bold text-gray-900'>AI 供应商</h1>
                    <p className='mt-1 text-sm text-gray-500'>
                        接入任意 OpenAI 兼容协议的供应商（DeepSeek / Moonshot / Ollama / OpenRouter 等），密钥保存在服务端，界面上只显示掩码。
                    </p>
                </div>
                <Button onPress={() => setCreating(true)}>+ 新建供应商</Button>
            </div>

            <div className='overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm'>
                <table className='w-full text-sm'>
                    <thead className='bg-gray-50 text-left text-xs text-gray-500 uppercase'>
                        <tr>
                            <th className='px-4 py-3'>供应商</th>
                            <th className='px-4 py-3'>协议</th>
                            <th className='px-4 py-3'>Base URL</th>
                            <th className='px-4 py-3'>API Key</th>
                            <th className='px-4 py-3'>Embedding</th>
                            <th className='px-4 py-3'>状态</th>
                            <th className='px-4 py-3 text-right'>操作</th>
                        </tr>
                    </thead>
                    <tbody className='divide-y divide-gray-100'>
                        {providers.map((p) => (
                            <tr key={p.id}>
                                <td className='px-4 py-3 font-medium text-gray-900'>{p.name}</td>
                                <td className='px-4 py-3 text-xs text-gray-600'>{p.protocol}</td>
                                <td className='max-w-xs truncate px-4 py-3 font-mono text-xs text-gray-500'>{p.baseUrl}</td>
                                <td className='px-4 py-3 font-mono text-xs text-gray-500'>{p.hasKey ? p.apiKey : '未配置'}</td>
                                <td className='px-4 py-3 font-mono text-xs text-gray-500'>{p.embeddingModel ?? '—'}</td>
                                <td className='px-4 py-3'>
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-xs ${
                                            p.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                                        }`}
                                    >
                                        {p.enabled ? '启用' : '停用'}
                                    </span>
                                </td>
                                <td className='px-4 py-3 text-right'>
                                    <Button size='sm' variant='ghost' onPress={() => setEditing(p)}>
                                        编辑
                                    </Button>
                                    <Button
                                        size='sm'
                                        variant='ghost'
                                        className='text-red-500'
                                        onPress={() => {
                                            if (window.confirm(`确认删除供应商「${p.name}」？使用它的智能体将回退失败。`)) {
                                                deleteMutation.mutate(p.id);
                                            }
                                        }}
                                    >
                                        删除
                                    </Button>
                                </td>
                            </tr>
                        ))}
                        {!isLoading && providers.length === 0 ? (
                            <tr>
                                <td colSpan={7} className='px-4 py-8 text-center text-gray-400'>
                                    还没有自定义供应商，点击右上角接入
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            <ProviderFormModal
                open={creating}
                provider={null}
                onClose={() => setCreating(false)}
                onSaved={() => {
                    setCreating(false);
                    void invalidate();
                }}
            />
            <ProviderFormModal
                open={editing !== null}
                provider={editing}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    void invalidate();
                }}
            />
        </div>
    );
}

function ProviderFormModal({
    open,
    provider,
    onClose,
    onSaved,
}: {
    open: boolean;
    provider: AdminProvider | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [form, setForm] = useState(EMPTY_FORM);
    const [formId, setFormId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const openKey = `${open}:${provider?.id ?? 'new'}`;
    const [lastKey, setLastKey] = useState('');
    if (openKey !== lastKey) {
        setLastKey(openKey);
        setForm(
            provider
                ? {
                      name: provider.name,
                      protocol: provider.protocol,
                      baseUrl: provider.baseUrl,
                      apiKey: '',
                      embeddingModel: provider.embeddingModel ?? '',
                      enabled: provider.enabled,
                  }
                : EMPTY_FORM,
        );
        setFormId(provider?.id ?? null);
        setError(null);
    }

    if (!open) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            const body = JSON.stringify({
                name: form.name,
                protocol: form.protocol,
                baseUrl: form.baseUrl,
                apiKey: form.apiKey,
                embeddingModel: form.embeddingModel.trim() ? form.embeddingModel.trim() : null,
                enabled: form.enabled,
            });
            if (formId !== null) {
                await api(`/api/admin/providers/${formId}`, { method: 'PATCH', body });
            } else {
                await api('/api/admin/providers', { method: 'POST', body });
            }
            onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : '保存失败');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={formId !== null ? '编辑供应商' : '新建供应商'} onClose={onClose}>
            <form className='space-y-3' onSubmit={handleSubmit}>
                <div className='grid grid-cols-2 gap-3'>
                    <div>
                        <label className='mb-1 block text-xs font-medium text-gray-500'>名称</label>
                        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
                    </div>
                    <div>
                        <label className='mb-1 block text-xs font-medium text-gray-500'>协议</label>
                        <select value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value as AdminProvider['protocol'] })} className={inputClass}>
                            <option value='openai-compatible'>OpenAI 兼容</option>
                            <option value='deepseek'>DeepSeek</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label className='mb-1 block text-xs font-medium text-gray-500'>Base URL（如 https://api.moonshot.cn/v1）</label>
                    <input required value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className={inputClass} />
                </div>
                <div>
                    <label className='mb-1 block text-xs font-medium text-gray-500'>
                        API Key（{formId !== null ? '留空保持不变' : '服务端保存'}）
                    </label>
                    <input
                        type='password'
                        value={form.apiKey}
                        onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                        className={inputClass}
                        placeholder={formId !== null ? '留空则不修改' : 'sk-...'}
                    />
                </div>
                <div>
                    <label className='mb-1 block text-xs font-medium text-gray-500'>Embedding 模型（可选，供知识库向量化）</label>
                    <input
                        value={form.embeddingModel}
                        onChange={(e) => setForm({ ...form, embeddingModel: e.target.value })}
                        className={inputClass}
                        placeholder='如 text-embedding-3-small，留空表示不支持'
                    />
                </div>
                <label className='flex items-center gap-2 text-sm text-gray-700'>
                    <input type='checkbox' checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                    启用
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

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
    return (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4' onClick={onClose}>
            <div
                className='max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl'
                onClick={(e) => e.stopPropagation()}
            >
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
