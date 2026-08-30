import { Button } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '@/lib/client-api';

interface AdminAgent {
    id: number;
    name: string;
    emoji: string;
    description: string;
    systemPrompt: string;
    model: string;
    providerId: number | null;
    enabled: boolean;
    skillIds: number[];
    toolIds: number[];
    knowledgeBaseIds: number[];
    mcpServerIds: number[];
}

interface AdminSkill {
    id: number;
    name: string;
    enabled: boolean;
}

interface AdminTool {
    id: number;
    name: string;
    enabled: boolean;
}

interface AdminMcpServer {
    id: number;
    name: string;
    enabled: boolean;
}

interface KnowledgeBaseOption {
    id: number;
    name: string;
}

interface AdminProvider {
    id: number;
    name: string;
    hasKey: boolean;
    embeddingModel: string | null;
    enabled: boolean;
}

const EMPTY_FORM: Omit<AdminAgent, 'id'> = {
    name: '',
    emoji: '🤖',
    description: '',
    systemPrompt: '',
    model: 'deepseek:deepseek-chat',
    providerId: null,
    enabled: true,
    skillIds: [],
    toolIds: [],
    knowledgeBaseIds: [],
    mcpServerIds: [],
};

const inputClass =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

export const Route = createFileRoute('/admin/agents')({
    component: AdminAgentsPage,
});

function AdminAgentsPage() {
    const queryClient = useQueryClient();
    const { data: agents = [], isLoading } = useQuery({
        queryKey: ['admin', 'agents'],
        queryFn: () => api<AdminAgent[]>('/api/admin/agents'),
    });
    const { data: skills = [] } = useQuery({
        queryKey: ['admin', 'skills'],
        queryFn: () => api<AdminSkill[]>('/api/admin/skills'),
    });
    const { data: tools = [] } = useQuery({
        queryKey: ['admin', 'tools'],
        queryFn: () => api<AdminTool[]>('/api/admin/tools'),
    });
    const { data: providers = [] } = useQuery({
        queryKey: ['admin', 'providers'],
        queryFn: () => api<AdminProvider[]>('/api/admin/providers'),
    });
    const { data: knowledgeBases = [] } = useQuery({
        queryKey: ['admin', 'knowledge'],
        queryFn: () => api<KnowledgeBaseOption[]>('/api/admin/knowledge'),
    });
    const { data: mcpServers = [] } = useQuery({
        queryKey: ['admin', 'mcp'],
        queryFn: () => api<AdminMcpServer[]>('/api/admin/mcp'),
    });
    const { data: builtinProviders = [] } = useQuery({
        queryKey: ['admin', 'builtin-providers'],
        queryFn: () => api<{ id: string; label: string }[]>('/api/admin/builtin-providers'),
    });

    const [editing, setEditing] = useState<AdminAgent | null>(null);
    const [creating, setCreating] = useState(false);

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'agents'] });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => api(`/api/admin/agents/${id}`, { method: 'DELETE' }),
        onSuccess: invalidate,
    });

    return (
        <div className='space-y-4'>
            <div className='flex items-center justify-between'>
                <h1 className='text-xl font-bold text-gray-900'>智能体管理</h1>
                <Button onPress={() => setCreating(true)}>+ 新建智能体</Button>
            </div>

            <div className='overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm'>
                <table className='w-full text-sm'>
                    <thead className='bg-gray-50 text-left text-xs text-gray-500 uppercase'>
                        <tr>
                            <th className='px-4 py-3'>智能体</th>
                            <th className='px-4 py-3'>模型</th>
                            <th className='px-4 py-3'>Skills / Tools / 知识库</th>
                            <th className='px-4 py-3'>状态</th>
                            <th className='px-4 py-3 text-right'>操作</th>
                        </tr>
                    </thead>
                    <tbody className='divide-y divide-gray-100'>
                        {agents.map((agent) => (
                            <tr key={agent.id}>
                                <td className='px-4 py-3'>
                                    <div className='font-medium text-gray-900'>
                                        {agent.emoji} {agent.name}
                                    </div>
                                    <div className='max-w-md truncate text-xs text-gray-400'>{agent.description}</div>
                                </td>
                                <td className='px-4 py-3 font-mono text-xs text-gray-600'>
                                    {providerLabel(agent.providerId, providers)}
                                    <span className='mx-1 text-gray-300'>/</span>
                                    {agent.model}
                                </td>
                                <td className='px-4 py-3 text-xs text-gray-600'>
                                    {[
                                        agent.skillIds.map((id) => skills.find((s) => s.id === id)?.name).filter(Boolean).length > 0
                                            ? `Skills×${agent.skillIds.length}`
                                            : null,
                                        agent.toolIds.length > 0 ? `Tools×${agent.toolIds.length}` : null,
                                        agent.knowledgeBaseIds.length > 0 ? `知识库×${agent.knowledgeBaseIds.length}` : null,
                                    ]
                                        .filter(Boolean)
                                        .join('、') || '—'}
                                </td>
                                <td className='px-4 py-3'>
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-xs ${
                                            agent.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                                        }`}
                                    >
                                        {agent.enabled ? '启用' : '停用'}
                                    </span>
                                </td>
                                <td className='px-4 py-3 text-right'>
                                    <Button size='sm' variant='ghost' onPress={() => setEditing(agent)}>
                                        编辑
                                    </Button>
                                    <Button
                                        size='sm'
                                        variant='ghost'
                                        className='text-red-500'
                                        onPress={() => {
                                            if (window.confirm(`确认删除「${agent.name}」？该智能体的会话也会一并删除。`)) {
                                                deleteMutation.mutate(agent.id);
                                            }
                                        }}
                                    >
                                        删除
                                    </Button>
                                </td>
                            </tr>
                        ))}
                        {!isLoading && agents.length === 0 ? (
                            <tr>
                                <td colSpan={5} className='px-4 py-8 text-center text-gray-400'>
                                    还没有智能体，点击右上角创建
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            <AgentFormModal
                open={creating}
                agent={null}
                skills={skills}
                tools={tools}
                providers={providers}
                knowledgeBases={knowledgeBases}
                builtinProviders={builtinProviders}
                mcpServers={mcpServers}
                onClose={() => setCreating(false)}
                onSaved={() => {
                    setCreating(false);
                    void invalidate();
                }}
            />
            <AgentFormModal
                open={editing !== null}
                agent={editing}
                skills={skills}
                tools={tools}
                providers={providers}
                knowledgeBases={knowledgeBases}
                builtinProviders={builtinProviders}
                mcpServers={mcpServers}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    void invalidate();
                }}
            />
        </div>
    );
}

function providerLabel(providerId: number | null, providers: AdminProvider[]) {
    if (providerId === null) return '内置';
    return providers.find((p) => p.id === providerId)?.name ?? `#${providerId}`;
}

function AgentFormModal({
    open,
    agent,
    skills,
    tools,
    providers,
    knowledgeBases,
    builtinProviders,
    mcpServers,
    onClose,
    onSaved,
}: {
    open: boolean;
    agent: AdminAgent | null;
    skills: AdminSkill[];
    tools: AdminTool[];
    providers: AdminProvider[];
    knowledgeBases: KnowledgeBaseOption[];
    builtinProviders: { id: string; label: string }[];
    mcpServers: AdminMcpServer[];
    onClose: () => void;
    onSaved: () => void;
}) {
    const [form, setForm] = useState<Omit<AdminAgent, 'id'>>(EMPTY_FORM);
    const [formAgentId, setFormAgentId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [autoConfiguring, setAutoConfiguring] = useState(false);
    const [autoDescription, setAutoDescription] = useState('');

    const openKey = `${open}:${agent?.id ?? 'new'}`;
    const [lastKey, setLastKey] = useState('');
    if (openKey !== lastKey) {
        setLastKey(openKey);
        setForm(
            agent
                ? { ...agent, skillIds: [...agent.skillIds], toolIds: [...agent.toolIds], knowledgeBaseIds: [...agent.knowledgeBaseIds], mcpServerIds: [...agent.mcpServerIds] }
                : EMPTY_FORM,
        );
        setFormAgentId(agent?.id ?? null);
        setError(null);
        setAutoDescription('');
    }

    if (!open) return null;

    const runAutoConfig = async () => {
        if (autoDescription.trim().length < 5) {
            setError('请先在下方填写智能体用途描述（至少 5 个字）');
            return;
        }
        setAutoConfiguring(true);
        setError(null);
        try {
            const draft = await api<{
                name: string;
                emoji: string;
                description: string;
                systemPrompt: string;
                providerId: number | null;
                model: string;
                skillIds: number[];
                toolIds: number[];
                mcpServerIds: number[];
            }>('/api/admin/agents/auto-config', {
                method: 'POST',
                body: JSON.stringify({ description: autoDescription.trim() }),
            });
            setForm((prev) => ({
                ...prev,
                name: draft.name,
                emoji: draft.emoji,
                description: draft.description,
                systemPrompt: draft.systemPrompt,
                providerId: draft.providerId,
                model: draft.model,
                skillIds: draft.skillIds,
                toolIds: draft.toolIds,
                mcpServerIds: draft.mcpServerIds,
            }));
            setForm((prev) => ({
                ...prev,
                name: draft.name,
                emoji: draft.emoji,
                description: draft.description,
                systemPrompt: draft.systemPrompt,
                providerId: draft.providerId,
                model: draft.model,
                skillIds: draft.skillIds,
                toolIds: draft.toolIds,
            }));
        } catch (err) {
            setError(err instanceof Error ? err.message : '自动配置失败');
        } finally {
            setAutoConfiguring(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            const body = JSON.stringify(form);
            if (formAgentId !== null) {
                await api(`/api/admin/agents/${formAgentId}`, { method: 'PATCH', body });
            } else {
                await api('/api/admin/agents', { method: 'POST', body });
            }
            onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : '保存失败');
        } finally {
            setSaving(false);
        }
    };

    const toggleId = (list: number[], id: number) =>
        list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

    return (
        <Modal title={formAgentId !== null ? '编辑智能体' : '新建智能体'} onClose={onClose}>
            <form className='space-y-3' onSubmit={handleSubmit}>
                {/* AI 自动配置 */}
                <div className='rounded-lg border border-blue-200 bg-blue-50/60 p-3'>
                    <label className='mb-1 block text-xs font-medium text-blue-700'>AI 自动配置：描述你想要的智能体，AI 生成配置草案（可再手动调整）</label>
                    <div className='flex gap-2'>
                        <input
                            value={autoDescription}
                            onChange={(e) => setAutoDescription(e.target.value)}
                            className={inputClass}
                            placeholder='例如：一个帮我整理每日新闻并生成摘要卡片的助手'
                        />
                        <Button type='button' variant='ghost' className='shrink-0' isDisabled={autoConfiguring} onPress={() => void runAutoConfig()}>
                            {autoConfiguring ? '配置中…' : '✨ 自动配置'}
                        </Button>
                    </div>
                </div>

                <div className='grid grid-cols-[80px_1fr] gap-3'>
                    <Field label='Emoji'>
                        <input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} className={inputClass} maxLength={8} />
                    </Field>
                    <Field label='名称'>
                        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
                    </Field>
                </div>
                <Field label='描述'>
                    <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
                </Field>
                <div className='grid grid-cols-2 gap-3'>
                    <Field label='供应商'>
                        <select
                            value={form.providerId ?? ''}
                            onChange={(e) => setForm({ ...form, providerId: e.target.value ? Number(e.target.value) : null })}
                            className={inputClass}
                        >
                            {builtinProviders.length === 0 ? <option value=''>内置（未配置 key）</option> : null}
                            {builtinProviders.map((b) => (
                                <option key={b.id} value=''>
                                    {b.label}
                                </option>
                            ))}
                            {providers
                                .filter((p) => p.enabled)
                                .map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name}
                                    </option>
                                ))}
                        </select>
                    </Field>
                    <Field label='模型 ID'>
                        <input
                            required
                            value={form.model}
                            onChange={(e) => setForm({ ...form, model: e.target.value })}
                            className={inputClass}
                            placeholder={form.providerId === null ? 'deepseek:deepseek-chat' : 'qwen-max / glm-4 / ...'}
                        />
                    </Field>
                </div>
                <Field label='系统提示词（人设与规则）'>
                    <textarea
                        value={form.systemPrompt}
                        onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                        className={`${inputClass} h-28 resize-y font-mono text-xs`}
                        placeholder='你是一个…类型的助手，回答风格…'
                    />
                </Field>
                <Field label='挂载 Skills'>
                    <div className='flex flex-wrap gap-2'>
                        {skills.map((s) => {
                            const checked = form.skillIds.includes(s.id);
                            return (
                                <label
                                    key={s.id}
                                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                                        checked ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'
                                    }`}
                                >
                                    <input
                                        type='checkbox'
                                        checked={checked}
                                        onChange={() => setForm({ ...form, skillIds: toggleId(form.skillIds, s.id) })}
                                    />
                                    {s.name}
                                </label>
                            );
                        })}
                        {skills.length === 0 ? <span className='text-xs text-gray-400'>暂无 Skill</span> : null}
                    </div>
                </Field>
                <Field label='挂载 Tools'>
                    <div className='flex flex-wrap gap-2'>
                        {tools.map((t) => {
                            const checked = form.toolIds.includes(t.id);
                            return (
                                <label
                                    key={t.id}
                                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                                        checked ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-600'
                                    }`}
                                >
                                    <input
                                        type='checkbox'
                                        checked={checked}
                                        onChange={() => setForm({ ...form, toolIds: toggleId(form.toolIds, t.id) })}
                                    />
                                    🔧 {t.name}
                                </label>
                            );
                        })}
                        {tools.length === 0 ? <span className='text-xs text-gray-400'>暂无 Tool</span> : null}
                    </div>
                </Field>
                <Field label='挂载知识库（RAG）'>
                    <div className='flex flex-wrap gap-2'>
                        {knowledgeBases.map((kb) => {
                            const checked = form.knowledgeBaseIds.includes(kb.id);
                            return (
                                <label
                                    key={kb.id}
                                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                                        checked ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600'
                                    }`}
                                >
                                    <input
                                        type='checkbox'
                                        checked={checked}
                                        onChange={() => setForm({ ...form, knowledgeBaseIds: toggleId(form.knowledgeBaseIds, kb.id) })}
                                    />
                                    📚 {kb.name}
                                </label>
                            );
                        })}
                        {knowledgeBases.length === 0 ? <span className='text-xs text-gray-400'>暂无知识库</span> : null}
                    </div>
                </Field>
                <Field label='挂载 MCP 服务器'>
                    <div className='flex flex-wrap gap-2'>
                        {mcpServers.map((m) => {
                            const checked = form.mcpServerIds.includes(m.id);
                            return (
                                <label
                                    key={m.id}
                                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                                        checked ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-600'
                                    }`}
                                >
                                    <input
                                        type='checkbox'
                                        checked={checked}
                                        onChange={() => setForm({ ...form, mcpServerIds: toggleId(form.mcpServerIds, m.id) })}
                                    />
                                    🔌 {m.name}
                                </label>
                            );
                        })}
                        {mcpServers.length === 0 ? <span className='text-xs text-gray-400'>暂无 MCP 服务器</span> : null}
                    </div>
                </Field>
                <label className='flex items-center gap-2 text-sm text-gray-700'>
                    <input type='checkbox' checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                    启用（对用户可见）
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className='mb-1 block text-xs font-medium text-gray-500'>{label}</label>
            {children}
        </div>
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
