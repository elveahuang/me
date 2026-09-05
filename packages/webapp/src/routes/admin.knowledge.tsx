import { api } from '@/lib/client-api';
import { Button } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';

interface KnowledgeBaseSummary {
    id: number;
    name: string;
    description: string;
    embeddingProviderId: number | null;
    embeddingModel: string | null;
    docCount: number;
}

export const Route = createFileRoute('/admin/knowledge')({
    component: AdminKnowledgePage,
});

function AdminKnowledgePage() {
    const queryClient = useQueryClient();
    const { data: kbs = [], isLoading } = useQuery({
        queryKey: ['admin', 'knowledge'],
        queryFn: () => api<KnowledgeBaseSummary[]>('/api/admin/knowledge'),
    });

    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState({ name: '', description: '' });
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'knowledge'] });

    const createMutation = useMutation({
        mutationFn: (body: string) => api('/api/admin/knowledge', { method: 'POST', body }),
        onSuccess: () => {
            setCreating(false);
            setForm({ name: '', description: '' });
            void invalidate();
        },
        onError: (e) => setError(e instanceof Error ? e.message : '创建失败'),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => api(`/api/admin/knowledge/${id}`, { method: 'DELETE' }),
        onSuccess: invalidate,
    });

    return (
        <div className='space-y-4'>
            <div className='flex items-center justify-between'>
                <div>
                    <h1 className='text-xl font-bold text-gray-900'>RAG 知识库</h1>
                    <p className='mt-1 text-sm text-gray-500'>
                        上传文档自动切块入库；挂载到智能体后，对话时会检索相关内容注入上下文。配置了 Embedding 供应商的库走向量检索，否则退化为关键词匹配。
                    </p>
                </div>
                <Button onPress={() => setCreating(true)}>+ 新建知识库</Button>
            </div>

            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
                {kbs.map((kb) => (
                    <div key={kb.id} className='flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm'>
                        <Link to='/admin/knowledge/$id' params={{ id: String(kb.id) }} className='text-base font-semibold text-gray-900 hover:text-blue-600'>
                            📚 {kb.name}
                        </Link>
                        <p className='mt-1 line-clamp-2 flex-1 text-xs text-gray-500'>{kb.description || '（无描述）'}</p>
                        <div className='mt-3 flex items-center justify-between text-xs text-gray-400'>
                            <span>
                                {kb.docCount} 篇文档 · {kb.embeddingModel ? '向量检索' : '关键词检索'}
                            </span>
                            <button
                                type='button'
                                className='text-red-400 hover:text-red-600'
                                onClick={() => {
                                    if (window.confirm(`确认删除知识库「${kb.name}」？文档与向量数据将一并删除。`)) {
                                        deleteMutation.mutate(kb.id);
                                    }
                                }}
                            >
                                删除
                            </button>
                        </div>
                    </div>
                ))}
                {!isLoading && kbs.length === 0 ? (
                    <div className='col-span-full rounded-xl border border-dashed border-gray-300 p-10 text-center text-gray-400'>
                        还没有知识库，点击右上角创建
                    </div>
                ) : null}
            </div>

            {creating ? (
                <Modal title='新建知识库' onClose={() => setCreating(false)}>
                    <form
                        className='space-y-3'
                        onSubmit={(e) => {
                            e.preventDefault();
                            setSaving(true);
                            createMutation.mutate(JSON.stringify(form));
                            setSaving(false);
                        }}
                    >
                        <div>
                            <label className='mb-1 block text-xs font-medium text-gray-500'>名称</label>
                            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
                        </div>
                        <div>
                            <label className='mb-1 block text-xs font-medium text-gray-500'>描述</label>
                            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
                        </div>
                        {error ? <p className='text-sm text-red-600'>{error}</p> : null}
                        <div className='flex justify-end gap-2 pt-1'>
                            <Button type='button' variant='ghost' onPress={() => setCreating(false)}>
                                取消
                            </Button>
                            <Button type='submit' isDisabled={saving}>
                                创建
                            </Button>
                        </div>
                    </form>
                </Modal>
            ) : null}
        </div>
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
