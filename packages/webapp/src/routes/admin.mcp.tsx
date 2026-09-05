import { api } from '@/lib/client-api';
import { Button } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

interface McpServer {
    id: number;
    name: string;
    description: string;
    transport: 'http' | 'sse' | 'stdio';
    url: string | null;
    command: string | null;
    args: string[] | null;
    env: Record<string, string> | null;
    enabled: boolean;
}

interface TestResult {
    ok: boolean;
    toolCount?: number;
    tools?: { name: string; description: string }[];
    error?: string;
}

const EMPTY_FORM = {
    name: '',
    description: '',
    transport: 'http' as McpServer['transport'],
    url: '',
    command: '',
    argsText: '',
    enabled: true,
};

const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

export const Route = createFileRoute('/admin/mcp')({
    component: AdminMcpPage,
});

function AdminMcpPage() {
    const queryClient = useQueryClient();
    const { data: servers = [], isLoading } = useQuery({
        queryKey: ['admin', 'mcp'],
        queryFn: () => api<McpServer[]>('/api/admin/mcp'),
    });

    const [editing, setEditing] = useState<McpServer | null>(null);
    const [creating, setCreating] = useState(false);
    const [testResult, setTestResult] = useState<string | null>(null);
    const [testingId, setTestingId] = useState<number | null>(null);

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'mcp'] });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => api(`/api/admin/mcp/${id}`, { method: 'DELETE' }),
        onSuccess: invalidate,
    });

    const testMutation = useMutation({
        mutationFn: (id: number) => api<TestResult>(`/api/admin/mcp/${id}/test`, { method: 'POST' }),
        onSuccess: (r) => {
            setTestingId(null);
            setTestResult(
                r.ok ? `连接成功，提供 ${r.toolCount} 个工具：${(r.tools ?? []).map((t) => t.name).join('、') || '（无工具）'}` : `连接失败：${r.error}`,
            );
        },
        onError: (e) => {
            setTestingId(null);
            setTestResult(e instanceof Error ? e.message : '测试失败');
        },
    });

    return (
        <div className='space-y-4'>
            <div className='flex items-center justify-between'>
                <div>
                    <h1 className='text-xl font-bold text-gray-900'>MCP 服务器</h1>
                    <p className='mt-1 text-sm text-gray-500'>
                        挂载到智能体后，MCP 服务器提供的工具会在对话中可用（Model Context Protocol）。支持 Streamable HTTP / SSE / stdio 三种传输。
                    </p>
                </div>
                <Button onPress={() => setCreating(true)}>+ 新建 MCP 服务器</Button>
            </div>

            {testResult ? <p className='text-sm text-gray-700'>{testResult}</p> : null}

            <div className='overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm'>
                <table className='w-full text-sm'>
                    <thead className='bg-gray-50 text-left text-xs text-gray-500 uppercase'>
                        <tr>
                            <th className='px-4 py-3'>服务器</th>
                            <th className='px-4 py-3'>传输</th>
                            <th className='px-4 py-3'>目标</th>
                            <th className='px-4 py-3'>状态</th>
                            <th className='px-4 py-3 text-right'>操作</th>
                        </tr>
                    </thead>
                    <tbody className='divide-y divide-gray-100'>
                        {servers.map((server) => (
                            <tr key={server.id}>
                                <td className='px-4 py-3'>
                                    <div className='font-medium text-gray-900'>{server.name}</div>
                                    <div className='max-w-sm truncate text-xs text-gray-400'>{server.description}</div>
                                </td>
                                <td className='px-4 py-3'>
                                    <span className='rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 uppercase'>{server.transport}</span>
                                </td>
                                <td className='max-w-xs truncate px-4 py-3 font-mono text-xs text-gray-500'>
                                    {server.transport === 'stdio' ? `${server.command} ${(server.args ?? []).join(' ')}` : server.url}
                                </td>
                                <td className='px-4 py-3'>
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-xs ${
                                            server.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                                        }`}
                                    >
                                        {server.enabled ? '启用' : '停用'}
                                    </span>
                                </td>
                                <td className='px-4 py-3 text-right'>
                                    <Button
                                        size='sm'
                                        variant='ghost'
                                        isDisabled={testingId === server.id}
                                        onPress={() => {
                                            setTestingId(server.id);
                                            setTestResult(null);
                                            testMutation.mutate(server.id);
                                        }}
                                    >
                                        {testingId === server.id ? '测试中…' : '测试连接'}
                                    </Button>
                                    <Button size='sm' variant='ghost' onPress={() => setEditing(server)}>
                                        编辑
                                    </Button>
                                    <Button
                                        size='sm'
                                        variant='ghost'
                                        className='text-red-500'
                                        onPress={() => {
                                            if (window.confirm(`确认删除 MCP 服务器「${server.name}」？`)) {
                                                deleteMutation.mutate(server.id);
                                            }
                                        }}
                                    >
                                        删除
                                    </Button>
                                </td>
                            </tr>
                        ))}
                        {!isLoading && servers.length === 0 ? (
                            <tr>
                                <td colSpan={5} className='px-4 py-8 text-center text-gray-400'>
                                    还没有 MCP 服务器，点击右上角接入
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            <McpFormModal
                open={creating}
                server={null}
                onClose={() => setCreating(false)}
                onSaved={() => {
                    setCreating(false);
                    void invalidate();
                }}
            />
            <McpFormModal
                open={editing !== null}
                server={editing}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    void invalidate();
                }}
            />
        </div>
    );
}

function McpFormModal({ open, server, onClose, onSaved }: { open: boolean; server: McpServer | null; onClose: () => void; onSaved: () => void }) {
    const [form, setForm] = useState(EMPTY_FORM);
    const [formId, setFormId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const openKey = `${open}:${server?.id ?? 'new'}`;
    const [lastKey, setLastKey] = useState('');
    if (openKey !== lastKey) {
        setLastKey(openKey);
        setForm(
            server
                ? {
                      name: server.name,
                      description: server.description,
                      transport: server.transport,
                      url: server.url ?? '',
                      command: server.command ?? '',
                      argsText: (server.args ?? []).join(' '),
                      enabled: server.enabled,
                  }
                : EMPTY_FORM,
        );
        setFormId(server?.id ?? null);
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
                description: form.description,
                transport: form.transport,
                url: form.transport === 'stdio' ? null : form.url,
                command: form.transport === 'stdio' ? form.command : null,
                args: form.transport === 'stdio' && form.argsText.trim() ? form.argsText.trim().split(/\s+/) : null,
                env: null,
                enabled: form.enabled,
            });
            if (formId !== null) {
                await api(`/api/admin/mcp/${formId}`, { method: 'PATCH', body });
            } else {
                await api('/api/admin/mcp', { method: 'POST', body });
            }
            onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : '保存失败');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={formId !== null ? '编辑 MCP 服务器' : '新建 MCP 服务器'} onClose={onClose}>
            <form className='space-y-3' onSubmit={handleSubmit}>
                <div className='grid grid-cols-2 gap-3'>
                    <div>
                        <label className='mb-1 block text-xs font-medium text-gray-500'>名称</label>
                        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
                    </div>
                    <div>
                        <label className='mb-1 block text-xs font-medium text-gray-500'>传输方式</label>
                        <select
                            value={form.transport}
                            onChange={(e) => setForm({ ...form, transport: e.target.value as McpServer['transport'] })}
                            className={inputClass}
                        >
                            <option value='http'>Streamable HTTP</option>
                            <option value='sse'>SSE（旧版）</option>
                            <option value='stdio'>stdio（本地进程）</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label className='mb-1 block text-xs font-medium text-gray-500'>描述</label>
                    <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
                </div>
                {form.transport === 'stdio' ? (
                    <>
                        <div>
                            <label className='mb-1 block text-xs font-medium text-gray-500'>命令（如 node / npx）</label>
                            <input
                                value={form.command}
                                onChange={(e) => setForm({ ...form, command: e.target.value })}
                                className={inputClass}
                                placeholder='node'
                            />
                        </div>
                        <div>
                            <label className='mb-1 block text-xs font-medium text-gray-500'>参数（空格分隔）</label>
                            <input
                                value={form.argsText}
                                onChange={(e) => setForm({ ...form, argsText: e.target.value })}
                                className={inputClass}
                                placeholder='server.js --port 3001'
                            />
                        </div>
                    </>
                ) : (
                    <div>
                        <label className='mb-1 block text-xs font-medium text-gray-500'>服务器 URL</label>
                        <input
                            required
                            value={form.url}
                            onChange={(e) => setForm({ ...form, url: e.target.value })}
                            className={inputClass}
                            placeholder='https://mcp.example.com/mcp'
                        />
                    </div>
                )}
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
