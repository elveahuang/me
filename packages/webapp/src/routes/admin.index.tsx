import { api } from '@/lib/client-api';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

interface AdminStats {
    totals: {
        users: number;
        agents: number;
        skills: number;
        conversations: number;
        messages: number;
        activeConversations24h: number;
        providers: number;
        providersEnabled: number;
        tools: number;
        mcpServers: number;
    };
    recentUsers: { id: string; name: string; email: string; role: string; createdAt: string }[];
    recentConversations: {
        id: number;
        title: string;
        agentName: string;
        agentEmoji: string;
        updatedAt: string;
    }[];
    modelUsage: { model: string; conversations: number }[];
}

export const Route = createFileRoute('/admin/')({
    component: AdminDashboard,
});

function AdminDashboard() {
    const { data, isLoading } = useQuery({
        queryKey: ['admin', 'stats'],
        queryFn: () => api<AdminStats>('/api/admin/stats'),
    });

    if (isLoading || !data) return <div className='text-sm text-gray-400'>加载中…</div>;

    const cards = [
        { label: '用户', value: data.totals.users, emoji: '👥' },
        { label: '智能体', value: data.totals.agents, emoji: '🤖' },
        { label: 'Skills', value: data.totals.skills, emoji: '🧩' },
        { label: 'Tools', value: data.totals.tools, emoji: '🔧' },
        { label: 'MCP 服务器', value: data.totals.mcpServers, emoji: '🌐' },
        { label: `AI 供应商（启用 ${data.totals.providersEnabled}）`, value: data.totals.providers, emoji: '🔌' },
        { label: '会话总数', value: data.totals.conversations, emoji: '💬' },
        { label: '24h 活跃会话', value: data.totals.activeConversations24h, emoji: '⚡' },
        { label: '消息总数', value: data.totals.messages, emoji: '✉️' },
    ];

    return (
        <div className='space-y-6'>
            <h1 className='text-xl font-bold text-gray-900'>数据总览</h1>
            <div className='grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6'>
                {cards.map((card) => (
                    <div key={card.label} className='rounded-xl border border-gray-200 bg-white p-4 shadow-sm'>
                        <div className='text-sm text-gray-500'>
                            {card.emoji} {card.label}
                        </div>
                        <div className='mt-2 text-3xl font-bold text-gray-900 tabular-nums'>{card.value}</div>
                    </div>
                ))}
            </div>

            <div className='grid gap-6 lg:grid-cols-2'>
                <section className='rounded-xl border border-gray-200 bg-white p-5 shadow-sm'>
                    <h2 className='text-sm font-semibold text-gray-900'>最近会话</h2>
                    <ul className='mt-3 divide-y divide-gray-100 text-sm'>
                        {data.recentConversations.map((c) => (
                            <li key={c.id} className='flex items-center justify-between py-2'>
                                <div className='min-w-0'>
                                    <div className='truncate font-medium text-gray-800'>
                                        {c.agentEmoji} {c.title || '新对话'}
                                    </div>
                                    <div className='text-xs text-gray-400'>
                                        {c.agentName} · {new Date(c.updatedAt).toLocaleString()}
                                    </div>
                                </div>
                            </li>
                        ))}
                        {data.recentConversations.length === 0 ? <li className='py-2 text-gray-400'>暂无会话</li> : null}
                    </ul>
                </section>

                <section className='rounded-xl border border-gray-200 bg-white p-5 shadow-sm'>
                    <h2 className='text-sm font-semibold text-gray-900'>最近注册用户</h2>
                    <ul className='mt-3 divide-y divide-gray-100 text-sm'>
                        {data.recentUsers.map((u) => (
                            <li key={u.id} className='flex items-center justify-between py-2'>
                                <div>
                                    <div className='font-medium text-gray-800'>{u.name}</div>
                                    <div className='text-xs text-gray-400'>{u.email}</div>
                                </div>
                                <span
                                    className={`rounded-full px-2 py-0.5 text-xs ${
                                        u.role.includes('admin') ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                                    }`}
                                >
                                    {u.role.includes('admin') ? '管理员' : '用户'}
                                </span>
                            </li>
                        ))}
                        {data.recentUsers.length === 0 ? <li className='py-2 text-gray-400'>暂无用户</li> : null}
                    </ul>
                </section>

                <section className='rounded-xl border border-gray-200 bg-white p-5 shadow-sm'>
                    <h2 className='text-sm font-semibold text-gray-900'>会话模型分布</h2>
                    <ul className='mt-3 space-y-2 text-sm'>
                        {data.modelUsage.map((m) => {
                            const max = Math.max(...data.modelUsage.map((x) => x.conversations), 1);
                            return (
                                <li key={m.model}>
                                    <div className='flex justify-between text-gray-700'>
                                        <span>{m.model}</span>
                                        <span className='text-gray-500 tabular-nums'>{m.conversations}</span>
                                    </div>
                                    <div className='mt-1 h-2 rounded-full bg-gray-100'>
                                        <div className='h-2 rounded-full bg-blue-500' style={{ width: `${(m.conversations / max) * 100}%` }} />
                                    </div>
                                </li>
                            );
                        })}
                        {data.modelUsage.length === 0 ? <li className='text-gray-400'>暂无会话</li> : null}
                    </ul>
                </section>
            </div>
        </div>
    );
}
