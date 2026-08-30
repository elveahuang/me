import { Button } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '@/lib/client-api';

interface ToolParameter {
    name: string;
    type: 'string' | 'number' | 'boolean';
    description?: string;
    required?: boolean;
}

interface AdminTool {
    id: number;
    name: string;
    description: string;
    type: 'builtin_time' | 'http';
    config: {
        url?: string;
        method?: string;
        headers?: Record<string, string>;
        bodyTemplate?: string;
        parameters?: ToolParameter[];
    };
    enabled: boolean;
}

const EMPTY_FORM = {
    name: '',
    description: '',
    type: 'builtin_time' as AdminTool['type'],
    url: '',
    method: 'GET',
    bodyTemplate: '',
    parametersText: '',
    enabled: true,
};

const inputClass =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

export const Route = createFileRoute('/admin/tools')({
    component: AdminToolsPage,
});

function parseParameters(text: string): ToolParameter[] {
    // 每行一个参数：名称,类型(string/number/boolean),说明,required
    const result: ToolParameter[] = [];
    for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
        const [name = '', type = 'string', description = '', required = ''] = line.split(',').map((s) => s.trim());
        if (!name) continue;
        result.push({
            name,
            type: (['string', 'number', 'boolean'].includes(type) ? type : 'string') as ToolParameter['type'],
            description: description || undefined,
            required: required === 'required' || required === 'true',
        });
    }
    return result;
}

function AdminToolsPage() {
    const queryClient = useQueryClient();
    const { data: tools = [], isLoading } = useQuery({
        queryKey: ['admin', 'tools'],
        queryFn: () => api<AdminTool[]>('/api/admin/tools'),
    });

    const [editing, setEditing] = useState<AdminTool | null>(null);
    const [creating, setCreating] = useState(false);

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'tools'] });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => api(`/api/admin/tools/${id}`, { method: 'DELETE' }),
        onSuccess: invalidate,
    });

    return (
        <div className='space-y-4'>
            <div className='flex items-center justify-between'>
                <div>
                    <h1 className='text-xl font-bold text-gray-900'>Tool 管理</h1>
                    <p className='mt-1 text-sm text-gray-500'>
                        工具以 AI SDK tool calling 的形式挂载到智能体；HTTP 工具的 URL 与请求体支持 {'{{参数}}'} 模板占位符。
                    </p>
                </div>
                <Button onPress={() => setCreating(true)}>+ 新建 Tool</Button>
            </div>

            <div className='overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm'>
                <table className='w-full text-sm'>
                    <thead className='bg-gray-50 text-left text-xs text-gray-500 uppercase'>
                        <tr>
                            <th className='px-4 py-3'>工具</th>
                            <th className='px-4 py-3'>类型</th>
                            <th className='px-4 py-3'>目标 / 参数</th>
                            <th className='px-4 py-3'>状态</th>
                            <th className='px-4 py-3 text-right'>操作</th>
                        </tr>
                    </thead>
                    <tbody className='divide-y divide-gray-100'>
                        {tools.map((tool) => (
                            <tr key={tool.id}>
                                <td className='px-4 py-3'>
                                    <div className='font-medium text-gray-900'>{tool.name}</div>
                                    <div className='max-w-sm truncate text-xs text-gray-400'>{tool.description}</div>
                                </td>
                                <td className='px-4 py-3'>
                                    <span className='rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600'>
                                        {tool.type === 'http' ? 'HTTP' : '内置'}
                                    </span>
                                </td>
                                <td className='max-w-sm truncate px-4 py-3 font-mono text-xs text-gray-500'>
                                    {tool.type === 'http'
                                        ? `${(tool.config.method ?? 'GET').toUpperCase()} ${tool.config.url ?? ''}（${tool.config.parameters?.length ?? 0} 参数）`
                                        : '—'}
                                </td>
                                <td className='px-4 py-3'>
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-xs ${
                                            tool.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                                        }`}
                                    >
                                        {tool.enabled ? '启用' : '停用'}
                                    </span>
                                </td>
                                <td className='px-4 py-3 text-right'>
                                    <Button size='sm' variant='ghost' onPress={() => setEditing(tool)}>
                                        编辑
                                    </Button>
                                    <Button
                                        size='sm'
                                        variant='ghost'
                                        className='text-red-500'
                                        onPress={() => {
                                            if (window.confirm(`确认删除工具「${tool.name}」？`)) {
                                                deleteMutation.mutate(tool.id);
                                            }
                                        }}
                                    >
                                        删除
                                    </Button>
                                </td>
                            </tr>
                        ))}
                        {!isLoading && tools.length === 0 ? (
                            <tr>
                                <td colSpan={5} className='px-4 py-8 text-center text-gray-400'>
                                    还没有工具，点击右上角创建
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            <ToolFormModal
                open={creating}
                tool={null}
                onClose={() => setCreating(false)}
                onSaved={() => {
                    setCreating(false);
                    void invalidate();
                }}
            />
            <ToolFormModal
                open={editing !== null}
                tool={editing}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    void invalidate();
                }}
            />
        </div>
    );
}

function ToolFormModal({
    open,
    tool,
    onClose,
    onSaved,
}: {
    open: boolean;
    tool: AdminTool | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [form, setForm] = useState(EMPTY_FORM);
    const [formId, setFormId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const openKey = `${open}:${tool?.id ?? 'new'}`;
    const [lastKey, setLastKey] = useState('');
    if (openKey !== lastKey) {
        setLastKey(openKey);
        setForm(
            tool
                ? {
                      name: tool.name,
                      description: tool.description,
                      type: tool.type,
                      url: tool.config.url ?? '',
                      method: (tool.config.method ?? 'GET').toUpperCase(),
                      bodyTemplate: tool.config.bodyTemplate ?? '',
                      parametersText: (tool.config.parameters ?? [])
                          .map((p) => [p.name, p.type, p.description ?? '', p.required ? 'required' : ''].join(','))
                          .join('\n'),
                      enabled: tool.enabled,
                  }
                : EMPTY_FORM,
        );
        setFormId(tool?.id ?? null);
        setError(null);
    }

    if (!open) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            const parameters = parseParameters(form.parametersText);
            const body = JSON.stringify({
                name: form.name,
                description: form.description,
                type: form.type,
                config:
                    form.type === 'http'
                        ? {
                              url: form.url,
                              method: form.method,
                              bodyTemplate: form.bodyTemplate || undefined,
                              parameters,
                          }
                        : {},
                enabled: form.enabled,
            });
            if (formId !== null) {
                await api(`/api/admin/tools/${formId}`, { method: 'PATCH', body });
            } else {
                await api('/api/admin/tools', { method: 'POST', body });
            }
            onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : '保存失败');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={formId !== null ? '编辑工具' : '新建工具'} onClose={onClose}>
            <form className='space-y-3' onSubmit={handleSubmit}>
                <div className='grid grid-cols-2 gap-3'>
                    <div>
                        <label className='mb-1 block text-xs font-medium text-gray-500'>名称</label>
                        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
                    </div>
                    <div>
                        <label className='mb-1 block text-xs font-medium text-gray-500'>类型</label>
                        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AdminTool['type'] })} className={inputClass}>
                            <option value='builtin_time'>内置：查询当前时间</option>
                            <option value='http'>HTTP 请求</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label className='mb-1 block text-xs font-medium text-gray-500'>描述（模型据此决定何时调用）</label>
                    <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
                </div>

                {form.type === 'http' ? (
                    <>
                        <div className='grid grid-cols-[110px_1fr] gap-3'>
                            <div>
                                <label className='mb-1 block text-xs font-medium text-gray-500'>Method</label>
                                <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className={inputClass}>
                                    {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                                        <option key={m} value={m}>
                                            {m}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className='mb-1 block text-xs font-medium text-gray-500'>URL（支持 {'{{参数}}'}）</label>
                                <input
                                    required
                                    value={form.url}
                                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                                    className={inputClass}
                                    placeholder='https://api.example.com/weather?city={{city}}'
                                />
                            </div>
                        </div>
                        <div>
                            <label className='mb-1 block text-xs font-medium text-gray-500'>请求体模板（可选，POST/PUT 时使用）</label>
                            <textarea
                                value={form.bodyTemplate}
                                onChange={(e) => setForm({ ...form, bodyTemplate: e.target.value })}
                                className={`${inputClass} h-20 resize-y font-mono text-xs`}
                                placeholder='{"city": "{{city}}"}'
                            />
                        </div>
                        <div>
                            <label className='mb-1 block text-xs font-medium text-gray-500'>
                                参数（每行：名称,类型,说明,required）
                            </label>
                            <textarea
                                value={form.parametersText}
                                onChange={(e) => setForm({ ...form, parametersText: e.target.value })}
                                className={`${inputClass} h-20 resize-y font-mono text-xs`}
                                placeholder={'city,string,城市名称,required\ndays,number,预报天数'}
                            />
                        </div>
                    </>
                ) : null}

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
