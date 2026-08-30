import { Button } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '@/lib/client-api';

interface AdminSkill {
    id: number;
    name: string;
    description: string;
    instructions: string;
    enabled: boolean;
}

const EMPTY_FORM = { name: '', description: '', instructions: '', enabled: true };

export const Route = createFileRoute('/admin/skills')({
    component: AdminSkillsPage,
});

function AdminSkillsPage() {
    const queryClient = useQueryClient();
    const { data: skills = [], isLoading } = useQuery({
        queryKey: ['admin', 'skills'],
        queryFn: () => api<AdminSkill[]>('/api/admin/skills'),
    });

    const [editing, setEditing] = useState<AdminSkill | null>(null);
    const [creating, setCreating] = useState(false);

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'skills'] });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => api(`/api/admin/skills/${id}`, { method: 'DELETE' }),
        onSuccess: invalidate,
    });

    return (
        <div className='space-y-4'>
            <div className='flex items-center justify-between'>
                <div>
                    <h1 className='text-xl font-bold text-gray-900'>Skill 管理</h1>
                    <p className='mt-1 text-sm text-gray-500'>Skill 是可复用的指令块，挂载到智能体后会注入其系统提示词。</p>
                </div>
                <Button onPress={() => setCreating(true)}>+ 新建 Skill</Button>
            </div>

            <div className='overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm'>
                <table className='w-full text-sm'>
                    <thead className='bg-gray-50 text-left text-xs text-gray-500 uppercase'>
                        <tr>
                            <th className='px-4 py-3'>Skill</th>
                            <th className='px-4 py-3'>指令预览</th>
                            <th className='px-4 py-3'>状态</th>
                            <th className='px-4 py-3 text-right'>操作</th>
                        </tr>
                    </thead>
                    <tbody className='divide-y divide-gray-100'>
                        {skills.map((skill) => (
                            <tr key={skill.id}>
                                <td className='px-4 py-3'>
                                    <div className='font-medium text-gray-900'>{skill.name}</div>
                                    <div className='max-w-sm truncate text-xs text-gray-400'>{skill.description}</div>
                                </td>
                                <td className='max-w-md truncate px-4 py-3 font-mono text-xs text-gray-500'>{skill.instructions}</td>
                                <td className='px-4 py-3'>
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-xs ${
                                            skill.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                                        }`}
                                    >
                                        {skill.enabled ? '启用' : '停用'}
                                    </span>
                                </td>
                                <td className='px-4 py-3 text-right'>
                                    <Button size='sm' variant='ghost' onPress={() => setEditing(skill)}>
                                        编辑
                                    </Button>
                                    <Button
                                        size='sm'
                                        variant='ghost'
                                        className='text-red-500'
                                        onPress={() => {
                                            if (window.confirm(`确认删除「${skill.name}」？已挂载该 Skill 的智能体会自动解除关联。`)) {
                                                deleteMutation.mutate(skill.id);
                                            }
                                        }}
                                    >
                                        删除
                                    </Button>
                                </td>
                            </tr>
                        ))}
                        {!isLoading && skills.length === 0 ? (
                            <tr>
                                <td colSpan={4} className='px-4 py-8 text-center text-gray-400'>
                                    还没有 Skill，点击右上角创建
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            <SkillFormModal
                open={creating}
                skill={null}
                onClose={() => setCreating(false)}
                onSaved={() => {
                    setCreating(false);
                    void invalidate();
                }}
            />
            <SkillFormModal
                open={editing !== null}
                skill={editing}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    void invalidate();
                }}
            />
        </div>
    );
}

function SkillFormModal({
    open,
    skill,
    onClose,
    onSaved,
}: {
    open: boolean;
    skill: AdminSkill | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [form, setForm] = useState(EMPTY_FORM);
    const [formSkillId, setFormSkillId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const openKey = `${open}:${skill?.id ?? 'new'}`;
    const [lastKey, setLastKey] = useState('');
    if (openKey !== lastKey) {
        setLastKey(openKey);
        setForm(skill ? { ...skill } : EMPTY_FORM);
        setFormSkillId(skill?.id ?? null);
        setError(null);
    }

    if (!open) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            const body = JSON.stringify(form);
            if (formSkillId !== null) {
                await api(`/api/admin/skills/${formSkillId}`, { method: 'PATCH', body });
            } else {
                await api('/api/admin/skills', { method: 'POST', body });
            }
            onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : '保存失败');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={formSkillId !== null ? '编辑 Skill' : '新建 Skill'} onClose={onClose}>
            <form className='space-y-3' onSubmit={handleSubmit}>
                <div className='grid grid-cols-2 gap-3'>
                    <div>
                        <label className='mb-1 block text-xs font-medium text-gray-500'>名称</label>
                        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
                    </div>
                    <div>
                        <label className='mb-1 block text-xs font-medium text-gray-500'>描述</label>
                        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
                    </div>
                </div>
                <div>
                    <label className='mb-1 block text-xs font-medium text-gray-500'>指令内容（Markdown，注入到智能体系统提示词）</label>
                    <textarea
                        required
                        value={form.instructions}
                        onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                        className={`${inputClass} h-40 resize-y font-mono text-xs`}
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

const inputClass =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

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
