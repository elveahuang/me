import { api } from '@/lib/client-api';
import { Button } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';

interface KnowledgeBaseDetail {
    id: number;
    name: string;
    description: string;
    embeddingProviderId: number | null;
    embeddingModel: string | null;
    documents: {
        id: number;
        title: string;
        chunkCount: number;
        status: string;
        createdAt: string;
    }[];
}

interface ProviderOption {
    id: number;
    name: string;
    embeddingModel: string | null;
}

export const Route = createFileRoute('/admin/knowledge/$id')({
    component: KnowledgeDetailPage,
});

const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

function KnowledgeDetailPage() {
    const { id } = Route.useParams();
    const kbId = Number(id);
    const queryClient = useQueryClient();

    const { data: kb, isLoading } = useQuery({
        queryKey: ['admin', 'knowledge', kbId],
        queryFn: () => api<KnowledgeBaseDetail>(`/api/admin/knowledge/${kbId}`),
        enabled: Number.isInteger(kbId) && kbId > 0,
    });

    const { data: providers = [] } = useQuery({
        queryKey: ['admin', 'providers'],
        queryFn: () => api<ProviderOption[]>('/api/admin/providers'),
    });

    const [showAdd, setShowAdd] = useState(false);
    const [docForm, setDocForm] = useState({ title: '', content: '' });
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'knowledge', kbId] });

    const { mutate: addDoc, isPending: addingDoc } = useMutation({
        mutationFn: async (body: string) =>
            api<{ chunkCount?: number; embedded?: boolean; error?: string }>(`/api/admin/knowledge/${kbId}/documents`, {
                method: 'POST',
                body,
            }),
        onSuccess: (result: { chunkCount?: number; embedded?: boolean; error?: string }) => {
            setShowAdd(false);
            setDocForm({ title: '', content: '' });
            setMessage(
                result.error
                    ? `文档已保存但入库失败：${result.error}`
                    : `入库成功：${result.chunkCount} 个块${result.embedded ? '，已完成向量化' : '（未配置 embedding，使用关键词检索）'}`,
            );
            void invalidate();
        },
        onError: (e) => setError(e instanceof Error ? e.message : '入库失败'),
    });

    const deleteDocument = useMutation({
        mutationFn: (docId: number) => api(`/api/admin/knowledge/${kbId}/documents/${docId}`, { method: 'DELETE' }),
        onSuccess: invalidate,
    });

    const reindexDocument = useMutation({
        mutationFn: (docId: number) => api(`/api/admin/knowledge/${kbId}/documents/${docId}`, { method: 'POST' }),
        onSuccess: () => {
            setMessage('已重建该文档的向量索引');
            void invalidate();
        },
        onError: (e) => setError(e instanceof Error ? e.message : '重建失败'),
    });

    const saveEmbeddingConfig = async (embeddingProviderId: number | null, embeddingModel: string | null) => {
        setError(null);
        try {
            await api(`/api/admin/knowledge/${kbId}`, {
                method: 'PATCH',
                body: JSON.stringify({ embeddingProviderId, embeddingModel }),
            });
            setMessage('已更新向量检索配置');
            void invalidate();
        } catch (e) {
            setError(e instanceof Error ? e.message : '更新失败');
        }
    };

    if (isLoading || !kb) return <div className='text-sm text-gray-400'>加载中…</div>;

    return (
        <div className='space-y-4'>
            <div className='flex items-start justify-between'>
                <div>
                    <Link to='/admin/knowledge' className='text-xs text-gray-400 hover:text-gray-600'>
                        ← 返回知识库列表
                    </Link>
                    <h1 className='mt-1 text-xl font-bold text-gray-900'>📚 {kb.name}</h1>
                    <p className='mt-1 text-sm text-gray-500'>{kb.description || '（无描述）'}</p>
                </div>
                <Button onPress={() => setShowAdd(true)}>+ 添加文档</Button>
            </div>

            {/* 向量检索配置 */}
            <div className='rounded-xl border border-gray-200 bg-white p-4 shadow-sm'>
                <h2 className='text-sm font-semibold text-gray-900'>向量检索配置</h2>
                <div className='mt-2 flex flex-wrap items-end gap-3 text-sm'>
                    <select
                        className={`${inputClass} max-w-xs`}
                        value={kb.embeddingProviderId ?? ''}
                        onChange={(e) => {
                            const providerId = e.target.value ? Number(e.target.value) : null;
                            void saveEmbeddingConfig(providerId, providerId ? kb.embeddingModel : null);
                        }}
                    >
                        <option value=''>不使用向量检索（关键词匹配）</option>
                        {providers
                            .filter((p) => p.embeddingModel)
                            .map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}（{p.embeddingModel}）
                                </option>
                            ))}
                    </select>
                    {kb.embeddingProviderId ? (
                        <div className='flex items-end gap-2'>
                            <div>
                                <label className='mb-1 block text-xs font-medium text-gray-500'>Embedding 模型</label>
                                <input
                                    className={inputClass}
                                    defaultValue={kb.embeddingModel ?? ''}
                                    onBlur={(e) => {
                                        if (e.target.value !== (kb.embeddingModel ?? '')) {
                                            void saveEmbeddingConfig(kb.embeddingProviderId, e.target.value.trim() || null);
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    ) : null}
                </div>
                <p className='mt-2 text-xs text-gray-400'>Embedding 模型在「AI 供应商」里按供应商配置；修改后需对文档执行「重建索引」。</p>
            </div>

            {message ? <p className='text-sm text-emerald-600'>{message}</p> : null}
            {error ? <p className='text-sm text-red-600'>{error}</p> : null}

            {/* 文档列表 */}
            <div className='overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm'>
                <table className='w-full text-sm'>
                    <thead className='bg-gray-50 text-left text-xs text-gray-500 uppercase'>
                        <tr>
                            <th className='px-4 py-3'>文档</th>
                            <th className='px-4 py-3'>块数</th>
                            <th className='px-4 py-3'>状态</th>
                            <th className='px-4 py-3'>入库时间</th>
                            <th className='px-4 py-3 text-right'>操作</th>
                        </tr>
                    </thead>
                    <tbody className='divide-y divide-gray-100'>
                        {kb.documents.map((doc) => (
                            <tr key={doc.id}>
                                <td className='px-4 py-3 font-medium text-gray-900'>{doc.title}</td>
                                <td className='px-4 py-3 text-gray-600 tabular-nums'>{doc.chunkCount}</td>
                                <td className='px-4 py-3'>
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-xs ${
                                            doc.status === 'embedded'
                                                ? 'bg-emerald-100 text-emerald-700'
                                                : doc.status === 'error'
                                                  ? 'bg-red-100 text-red-700'
                                                  : 'bg-gray-100 text-gray-600'
                                        }`}
                                    >
                                        {doc.status === 'embedded' ? '已向量化' : doc.status === 'error' ? '入库失败' : '关键词索引'}
                                    </span>
                                </td>
                                <td className='px-4 py-3 text-xs text-gray-500'>{new Date(doc.createdAt).toLocaleString()}</td>
                                <td className='px-4 py-3 text-right'>
                                    <Button size='sm' variant='ghost' onPress={() => reindexDocument.mutate(doc.id)}>
                                        重建索引
                                    </Button>
                                    <Button
                                        size='sm'
                                        variant='ghost'
                                        className='text-red-500'
                                        onPress={() => {
                                            if (window.confirm(`确认删除文档「${doc.title}」？`)) {
                                                deleteDocument.mutate(doc.id);
                                            }
                                        }}
                                    >
                                        删除
                                    </Button>
                                </td>
                            </tr>
                        ))}
                        {kb.documents.length === 0 ? (
                            <tr>
                                <td colSpan={5} className='px-4 py-8 text-center text-gray-400'>
                                    还没有文档，点击右上角添加（支持粘贴 Markdown / 纯文本）
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            {showAdd ? (
                <Modal title='添加文档' onClose={() => setShowAdd(false)}>
                    <form
                        className='space-y-3'
                        onSubmit={(e) => {
                            e.preventDefault();
                            addDoc(JSON.stringify(docForm));
                        }}
                    >
                        <div>
                            <label className='mb-1 block text-xs font-medium text-gray-500'>标题</label>
                            <input required value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} className={inputClass} />
                        </div>
                        <div>
                            <label className='mb-1 block text-xs font-medium text-gray-500'>正文（Markdown / 纯文本，≤ 20 万字）</label>
                            <textarea
                                required
                                value={docForm.content}
                                onChange={(e) => setDocForm({ ...docForm, content: e.target.value })}
                                className={`${inputClass} h-64 resize-y font-mono text-xs`}
                            />
                        </div>
                        <div className='flex justify-end gap-2 pt-1'>
                            <Button type='button' variant='ghost' onPress={() => setShowAdd(false)}>
                                取消
                            </Button>
                            <Button type='submit' isDisabled={addingDoc}>
                                {addingDoc ? '入库中…' : '入库'}
                            </Button>
                        </div>
                    </form>
                </Modal>
            ) : null}
        </div>
    );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
    return (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4' onClick={onClose}>
            <div className='max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl' onClick={(e) => e.stopPropagation()}>
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
