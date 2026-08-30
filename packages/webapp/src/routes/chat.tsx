import { Button } from '@heroui/react';
import { useChat } from '@ai-sdk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import type { UIMessage } from 'ai';
import { DefaultChatTransport } from 'ai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AssistantMarkdown } from '@/components/assistant-markdown';
import { AppHeader } from '@/components/app-header';
import { api } from '@/lib/client-api';
import type { SessionUser } from '@/components/app-header';
import { fetchSession } from '@/lib/session';

interface AgentSummary {
    id: number;
    name: string;
    emoji: string;
    description: string;
    model: string;
}

interface ConversationSummary {
    id: number;
    title: string;
    agentId: number;
    agentName: string;
    agentEmoji: string;
    updatedAt: string;
}

interface StoredMessage {
    id: string;
    role: string;
    parts: UIMessage['parts'];
}

export const Route = createFileRoute('/chat')({
    validateSearch: (search: Record<string, unknown>): { agentId?: number; conversationId?: number } => ({
        agentId: search.agentId ? Number(search.agentId) : undefined,
        conversationId: search.conversationId ? Number(search.conversationId) : undefined,
    }),
    beforeLoad: async () => {
        const session = await fetchSession();
        if (!session) throw redirect({ to: '/login' });
        return { session };
    },
    component: ChatPage,
});

function ChatPage() {
    const { session } = Route.useRouteContext();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { agentId, conversationId } = Route.useSearch();
    const user = session.user as SessionUser;

    const { data: agents = [] } = useQuery({
        queryKey: ['agents'],
        queryFn: () => api<AgentSummary[]>('/api/agents'),
    });

    const { data: conversations = [] } = useQuery({
        queryKey: ['conversations'],
        queryFn: () => api<ConversationSummary[]>('/api/conversations'),
    });

    const activeAgent = agents.find((a) => a.id === agentId) ?? agents[0];
    const activeConversationId = conversationId ?? null;

    const selectConversation = (id: number | null) => {
        navigate({
            to: '/chat',
            search: { agentId: activeAgent?.id, conversationId: id ?? undefined },
            replace: true,
        });
    };

    const stayOnAgent = (id: number) => {
        navigate({ to: '/chat', search: { agentId: id, conversationId: undefined }, replace: true });
    };

    return (
        <div className='flex h-dvh flex-col'>
            <AppHeader user={user} />
            <div className='flex min-h-0 flex-1'>
                {/* 侧边栏：智能体 + 会话列表 */}
                <aside className='flex w-72 shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white'>
                    <section className='p-3'>
                        <h2 className='px-1 pb-2 text-xs font-semibold tracking-wide text-gray-400 uppercase'>智能体</h2>
                        <div className='space-y-1'>
                            {agents.map((agent) => (
                                <button
                                    key={agent.id}
                                    type='button'
                                    onClick={() => {
                                        stayOnAgent(agent.id);
                                    }}
                                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                                        activeAgent?.id === agent.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                                    }`}
                                >
                                    <span className='text-lg'>{agent.emoji}</span>
                                    <span className='truncate font-medium'>{agent.name}</span>
                                </button>
                            ))}
                            {agents.length === 0 ? <p className='px-3 py-2 text-sm text-gray-400'>暂无可用智能体</p> : null}
                        </div>
                    </section>
                    <section className='flex min-h-0 flex-1 flex-col p-3 pt-0'>
                        <div className='flex items-center justify-between px-1 pb-2'>
                            <h2 className='text-xs font-semibold tracking-wide text-gray-400 uppercase'>会话</h2>
                            <Button
                                size='sm'
                                variant='ghost'
                                isDisabled={!activeAgent || activeConversationId === null}
                                onPress={() => selectConversation(null)}
                            >
                                + 新对话
                            </Button>
                        </div>
                        <div className='min-h-0 flex-1 space-y-1 overflow-y-auto'>
                            {conversations
                                .filter((c) => !activeAgent || c.agentId === activeAgent.id)
                                .map((c) => (
                                    <div
                                        key={c.id}
                                        className={`group flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                                            activeConversationId === c.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                                        }`}
                                    >
                                        <button type='button' className='min-w-0 flex-1 truncate text-left' onClick={() => selectConversation(c.id)}>
                                            {c.title || '新对话'}
                                        </button>
                                        <button
                                            type='button'
                                            aria-label='删除会话'
                                            className='hidden shrink-0 text-gray-400 hover:text-red-500 group-hover:block'
                                            onClick={async () => {
                                                await api(`/api/conversations/${c.id}`, { method: 'DELETE' });
                                                if (activeConversationId === c.id) selectConversation(null);
                                                await queryClient.invalidateQueries({ queryKey: ['conversations'] });
                                            }}
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            {conversations.filter((c) => !activeAgent || c.agentId === activeAgent.id).length === 0 ? (
                                <p className='px-3 py-2 text-sm text-gray-400'>还没有会话，发一条消息开始吧</p>
                            ) : null}
                        </div>
                    </section>
                </aside>

                {/* 主区域 */}
                <main className='min-w-0 flex-1'>
                    {activeAgent ? (
                        <ChatView
                            key={`${activeAgent.id}:${activeConversationId ?? 'new'}`}
                            agent={activeAgent}
                            conversationId={activeConversationId}
                            user={user}
                            onFirstMessageCreated={(id) => {
                                navigate({ to: '/chat', search: { agentId: activeAgent.id, conversationId: id }, replace: true });
                            }}                        />
                    ) : (
                        <div className='flex h-full items-center justify-center text-gray-400'>选择一个智能体开始对话</div>
                    )}
                </main>
            </div>
        </div>
    );
}

interface ChatViewProps {
    agent: AgentSummary;
    conversationId: number | null;
    user: SessionUser;
    onFirstMessageCreated: (conversationId: number) => void;
}

function ChatView({ agent, conversationId, onFirstMessageCreated }: ChatViewProps) {
    const queryClient = useQueryClient();
    const [input, setInput] = useState('');
    const createdRef = useRef<number | null>(conversationId);

    const { data: stored, isLoading: loadingMessages } = useQuery({
        queryKey: ['conversation', conversationId],
        queryFn: () => api<{ conversation: unknown; messages: StoredMessage[] }>(`/api/conversations/${conversationId}`),
        enabled: conversationId !== null,
    });

    const transport = useMemo(
        () =>
            new DefaultChatTransport({
                api: '/api/chat',
                body: () => ({ agentId: agent.id, conversationId: createdRef.current ?? undefined }),
                fetch: async (input, init) => {
                    const res = await fetch(input, init);
                    const headerId = res.headers.get('x-conversation-id');
                    if (headerId && createdRef.current === null) {
                        createdRef.current = Number(headerId);
                        onFirstMessageCreated(Number(headerId));
                    }
                    return res;
                },
            }),
        [agent.id],
    );

    const initialMessages = useMemo<UIMessage[]>(
        () =>
            (stored?.messages ?? []).map((m) => ({
                id: m.id,
                role: m.role === 'assistant' ? 'assistant' : 'user',
                parts: m.parts,
            })),
        [stored],
    );

    const chat = useChat({
        id: `conv-${agent.id}-${conversationId ?? 'new'}`,
        transport,
        onFinish: () => {
            void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        },
    });

    useEffect(() => {
        if (!chat.messages.length && initialMessages.length) {
            chat.setMessages(initialMessages);
        }
        // 仅在初始消息就绪后执行一次
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialMessages.length]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const text = input.trim();
        if (!text || chat.status === 'streaming' || chat.status === 'submitted') return;
        setInput('');
        chat.sendMessage({ text });
    };

    const statusText =
        chat.status === 'submitted' ? '思考中…' : chat.status === 'streaming' ? '回复中…' : chat.error ? chat.error.message : null;

    return (
        <div className='flex h-full flex-col'>
            <div className='flex items-center gap-2 border-b border-gray-200 bg-white px-6 py-3'>
                <span className='text-xl'>{agent.emoji}</span>
                <div>
                    <div className='text-sm font-semibold text-gray-900'>{agent.name}</div>
                    <div className='text-xs text-gray-400'>{agent.description || agent.model}</div>
                </div>
            </div>

            <div className='min-h-0 flex-1 overflow-y-auto bg-gray-50 px-6 py-4'>
                {loadingMessages && conversationId !== null ? (
                    <div className='text-center text-sm text-gray-400'>加载会话…</div>
                ) : (
                    <div className='mx-auto max-w-3xl space-y-4'>
                        {chat.messages.length === 0 ? (
                            <div className='pt-16 text-center text-gray-400'>
                                <div className='text-4xl'>{agent.emoji}</div>
                                <p className='mt-2 text-sm'>给 {agent.name} 发送第一条消息</p>
                            </div>
                        ) : null}
                        {chat.messages.map((message) => (
                            <MessageBubble key={message.id} message={message} streaming={chat.status === 'streaming'} />
                        ))}
                    </div>
                )}
            </div>

            <div className='border-t border-gray-200 bg-white px-6 py-4'>
                <form className='mx-auto flex max-w-3xl items-end gap-2' onSubmit={handleSubmit}>
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                void handleSubmit(e);
                            }
                        }}
                        rows={2}
                        placeholder='输入消息，Enter 发送，Shift+Enter 换行'
                        className='flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
                    />
                    <Button type='submit' isDisabled={chat.status === 'submitted' || chat.status === 'streaming' || !input.trim()}>
                        发送
                    </Button>
                </form>
                {statusText ? <p className='mx-auto mt-2 max-w-3xl text-xs text-gray-400'>{statusText}</p> : null}
            </div>
        </div>
    );
}

function MessageBubble({ message, streaming }: { message: UIMessage; streaming: boolean }) {
    const isUser = message.role === 'user';
    const text = message.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');

    if (isUser) {
        return (
            <div className='flex justify-end'>
                <div className='max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm whitespace-pre-wrap text-white'>
                    {text}
                </div>
            </div>
        );
    }

    return (
        <div className='flex justify-start'>
            <div className='max-w-[85%] rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-4 py-2.5 text-sm'>
                <AssistantMarkdown content={text} streaming={streaming} />
            </div>
        </div>
    );
}
