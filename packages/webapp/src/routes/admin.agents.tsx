import { Button } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '@/lib/client-api';
import { MODEL_PRESETS } from '@/lib/ai';

interface AdminAgent {
    id: number;
    name: string;
    emoji: string;
    description: string;
    systemPrompt: string;
    model: string;
    enabled: boolean;
    skillIds: number[];
}

interface AdminSkill {
    id: number;
    name: string;
    description: string;
    enabled: boolean;
}

const EMPTY_FORM: Omit<AdminAgent, 'id'> = {
    name: '',
    emoji: '🤖',
    description: '',
    systemPrompt: '',
    model: MODEL_PRESETS[0].id,
    enabled: true,
    skillIds: [],
};

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
                            <th className='px-4 py-3'>Skills</th>
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
                                <td className='px-4 py-3 font-mono text-xs text-gray-600'>{agent.model}</td>
                                <td className='px-4 py-3 text-xs text-gray-600'>
                                    {agent.skillIds
                                        .map((id) => skills.find((s) => s.id === id)?.name)
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
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    void invalidate();
                }}
            />
        </div>
    );
}

function AgentFormModal({
    open,
    agent,
    skills,
    onClose,
    onSaved,
}: {
    open: boolean;
    agent: AdminAgent | null;
    skills: AdminSkill[];
    onClose: () => void;
    onSaved: () => void;
}) {
    const [form, setForm] = useState(EMPTY_FORM);
    const [formAgentId, setFormAgentId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // 打开时同步表单（区分“新建”与“编辑某个智能体”）
    const openKey = `${open}:${agent?.id ?? 'new'}`;
    const [lastKey, setLastKey] = useState('');
    if (openKey !== lastKey) {
        setLastKey(openKey);
        setForm(agent ? { ...agent, skillIds: [...agent.skillIds] } : EMPTY_FORM);
        setFormAgentId(agent?.id ?? null);
        setError(null);
    }

    if (!open) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            const body = JSON.stringify({ ...form, skillIds: form.skillIds });
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

    return (
        <Modal title={formAgentId !== null ? '编辑智能体' : '新建智能体'} onClose={onClose}>
            <form className='space-y-3' onSubmit={handleSubmit}>
                <div className='grid grid-cols-[80px_1fr] gap-3'>
                    <Field label='Emoji'>
                        <input
                            value={form.emoji}
                            onChange={(e) => setForm({ ...form, emoji: e.target.value })}
                            className={inputClass}
                            maxLength={8}
                        />
                    </Field>
                    <Field label='名称'>
                        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
                    </Field>
                </div>
                <Field label='描述'>
                    <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
                </Field>
                <Field label='模型'>
                    <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className={inputClass}>
                        {MODEL_PRESETS.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.label}（{m.id}）
                            </option>
                        ))}
                    </select>
                </Field>
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
                                        onChange={(e) =>
                                            setForm({
                                                ...form,
                                                skillIds: e.target.checked ? [...form.skillIds, s.id] : form.skillIds.filter((id) => id !== s.id),
                                            })
                                        }
                                    />
                                    {s.name}
                                </label>
                            );
                        })}
                        {skills.length === 0 ? <span className='text-xs text-gray-400'>暂无 Skill，可先到「Skills」页创建</span> : null}
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

const inputClass =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

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
