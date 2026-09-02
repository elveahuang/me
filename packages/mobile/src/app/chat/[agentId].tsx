import { useLocalSearchParams, useNavigation } from 'expo-router';
import { fetch as expoFetch } from 'expo/fetch';
import { JSX, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { API_BASE_URL } from '@/lib/config';

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
}

interface Agent {
    id: number;
    name: string;
    emoji: string;
}

interface ConversationSummary {
    id: number;
    title: string;
    agentId: number;
    updatedAt: string;
}

interface StoredMessage {
    id: string;
    role: string;
    parts: { type: string; text?: string }[];
}

/** 解析 AI SDK UI message stream（SSE），增量回调文本 */
async function streamChat(
    token: string | null,
    body: object,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
): Promise<{ conversationId: number | null }> {
    const res = await expoFetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
    });

    if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(res.status, data.error ?? `请求失败 (${res.status})`);
    }

    // 服务端在首次对话时会新建会话并通过该头回传 ID
    const headerId = res.headers.get('x-conversation-id');

    const reader = res.body?.getReader();
    if (!reader) throw new Error('当前环境不支持流式响应');

    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
                const chunk = JSON.parse(payload) as { type: string; delta?: string; errorText?: string };
                if (chunk.type === 'text-delta' && chunk.delta) onDelta(chunk.delta);
                if (chunk.type === 'error' && chunk.errorText) throw new Error(chunk.errorText);
            } catch (e) {
                if (e instanceof SyntaxError) continue; // 非 JSON 行忽略
                throw e;
            }
        }
    }

    return { conversationId: headerId ? Number(headerId) : null };
}

export default function ChatScreen(): JSX.Element {
    const params = useLocalSearchParams<{ agentId: string }>();
    const agentId = Number(params.agentId);
    const navigation = useNavigation();
    const { token } = useAuth();

    const [agent, setAgent] = useState<Agent | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading-history' | 'loading-agent' | 'streaming'>('loading-agent');
    const [error, setError] = useState<string | null>(null);
    const [historyVisible, setHistoryVisible] = useState(false);
    const [conversations, setConversations] = useState<ConversationSummary[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
    const conversationIdRef = useRef<number | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const listRef = useRef<FlatList<ChatMessage>>(null);

    const loadConversation = useCallback(
        async (id: number) => {
            if (token === null) return;
            setStatus('loading-history');
            try {
                const detail = await api<{ messages: StoredMessage[] }>(`/api/conversations/${id}`, token);
                conversationIdRef.current = id;
                setActiveConversationId(id);
                setMessages(
                    detail.messages.map((m) => ({
                        id: m.id,
                        role: m.role === 'assistant' ? 'assistant' : 'user',
                        text: m.parts
                            .filter((p) => p.type === 'text')
                            .map((p) => p.text ?? '')
                            .join('\n'),
                    })),
                );
            } catch (e) {
                setError(e instanceof Error ? e.message : '加载会话失败');
            } finally {
                setStatus('idle');
            }
        },
        [token],
    );

    const startNewConversation = useCallback(() => {
        conversationIdRef.current = null;
        setActiveConversationId(null);
        setMessages([]);
        setInput('');
        setError(null);
        setStatus('idle');
    }, []);

    // 加载智能体信息（标题）+ 默认续接该智能体最近的会话
    useEffect(() => {
        if (!Number.isInteger(agentId) || agentId <= 0 || token === null) return;
        (async () => {
            try {
                const agents = await api<Agent[]>('/api/agents', token);
                const found = agents.find((a) => a.id === agentId) ?? null;
                setAgent(found);
                navigation.setOptions({ title: found ? `${found.emoji} ${found.name}` : '对话' });

                const conversations = await api<ConversationSummary[]>('/api/conversations', token);
                setConversations(conversations.filter((c) => c.agentId === agentId));
                const latest = conversations.find((c) => c.agentId === agentId);
                if (latest) {
                    await loadConversation(latest.id);
                    return;
                }
            } catch (e) {
                setError(e instanceof Error ? e.message : '加载失败');
            } finally {
                setStatus('idle');
            }
        })();
    }, [agentId, token, navigation, loadConversation]);

    const refreshConversations = useCallback(async () => {
        if (token === null) return;
        try {
            const all = await api<ConversationSummary[]>('/api/conversations', token);
            setConversations(all.filter((c) => c.agentId === agentId));
        } catch {
            // 列表刷新失败不阻塞对话
        }
    }, [agentId, token]);

    const stopStreaming = useCallback(() => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
    }, []);

    const send = useCallback(async () => {
        const text = input.trim();
        if (!text || status === 'streaming' || token === null) return;
        setError(null);
        setInput('');

        const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text };
        const assistantId = `a-${Date.now()}`;
        setMessages((prev) => [...prev, userMessage, { id: assistantId, role: 'assistant', text: '' }]);
        setStatus('streaming');

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const { conversationId: newConversationId } = await streamChat(
                token,
                {
                    agentId,
                    conversationId: conversationIdRef.current ?? undefined,
                    messages: [
                        ...messages.map((m) => ({
                            id: m.id,
                            role: m.role,
                            parts: [{ type: 'text', text: m.text }],
                        })),
                        { id: userMessage.id, role: 'user', parts: [{ type: 'text', text }] },
                    ],
                },
                (delta) => {
                    setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + delta } : m)));
                },
                controller.signal,
            );
            if (newConversationId !== null && conversationIdRef.current === null) {
                conversationIdRef.current = newConversationId;
                setActiveConversationId(newConversationId);
            }
        } catch (e) {
            const aborted = controller.signal.aborted;
            if (!aborted) {
                const message = e instanceof Error ? e.message : '发送失败';
                setError(message);
            }
            setMessages((prev) =>
                prev.map((m) =>
                    m.id === assistantId && (m.text === '' || controller.signal.aborted)
                        ? { ...m, text: m.text === '' ? (aborted ? '（已停止生成）' : `⚠️ ${e instanceof Error ? e.message : '发送失败'}`) : m.text }
                        : m,
                ),
            );
        } finally {
            abortControllerRef.current = null;
            setStatus('idle');
            void refreshConversations();
        }
    }, [agentId, input, messages, status, token, refreshConversations]);

    return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className='flex-1 bg-gray-50'>
            {/* 会话操作栏 */}
            <View className='flex-row items-center justify-end gap-2 border-b border-gray-200 bg-white px-4 py-2'>
                {activeConversationId !== null ? (
                    <Text className='mr-auto text-xs text-gray-400'>会话 #{activeConversationId}</Text>
                ) : (
                    <Text className='mr-auto text-xs text-gray-400'>新对话</Text>
                )}
                <Pressable
                    className='rounded-lg border border-gray-200 px-3 py-1.5'
                    onPress={() => {
                        void refreshConversations();
                        setHistoryVisible(true);
                    }}
                >
                    <Text className='text-xs text-gray-600'>历史会话</Text>
                </Pressable>
                <Pressable
                    className='rounded-lg border border-gray-200 px-3 py-1.5'
                    onPress={startNewConversation}
                    disabled={status === 'streaming'}
                >
                    <Text className='text-xs text-blue-600'>+ 新对话</Text>
                </Pressable>
            </View>

            <FlatList
                ref={listRef}
                data={messages}
                keyExtractor={(item) => item.id}
                contentContainerClassName='p-4 gap-3'
                onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
                ListEmptyComponent={
                    status === 'loading-agent' || status === 'loading-history' ? (
                        <View className='items-center py-16'>
                            <ActivityIndicator size='large' />
                        </View>
                    ) : (
                        <View className='items-center py-16'>
                            <Text className='text-4xl'>{agent?.emoji ?? '🤖'}</Text>
                            <Text className='mt-2 text-sm text-gray-400'>发送第一条消息开始对话</Text>
                        </View>
                    )
                }
                renderItem={({ item }) =>
                    item.role === 'user' ? (
                        <View className='flex-row justify-end'>
                            <View className='max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2.5'>
                                <Text className='text-sm text-white'>{item.text}</Text>
                            </View>
                        </View>
                    ) : (
                        <View className='flex-row justify-start'>
                            <View className='max-w-[85%] rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-4 py-2.5'>
                                <Text className='text-sm text-gray-900'>{item.text || '…'}</Text>
                            </View>
                        </View>
                    )
                }
            />

            {error ? <Text className='px-4 pb-1 text-xs text-red-600'>{error}</Text> : null}

            <View className='flex-row items-end gap-2 border-t border-gray-200 bg-white px-4 py-3'>
                <TextInput
                    className='max-h-28 min-h-[42px] flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm'
                    placeholder='输入消息…'
                    multiline
                    value={input}
                    onChangeText={setInput}
                    editable={status !== 'streaming'}
                />
                <Pressable
                    className='items-center justify-center rounded-xl bg-blue-600 px-5 py-3 active:bg-blue-700'
                    onPress={() => void send()}
                    disabled={status === 'streaming' || input.trim() === ''}
                >
                    {status === 'streaming' ? (
                        <ActivityIndicator color='white' size='small' />
                    ) : (
                        <Text className='text-sm font-semibold text-white'>发送</Text>
                    )}
                </Pressable>
                {status === 'streaming' ? (
                    <Pressable className='items-center justify-center rounded-xl border border-gray-300 px-4 py-3' onPress={stopStreaming}>
                        <Text className='text-sm text-gray-600'>停止</Text>
                    </Pressable>
                ) : null}
            </View>

            {/* 历史会话弹层 */}
            <Modal visible={historyVisible} animationType='slide' transparent onRequestClose={() => setHistoryVisible(false)}>
                <Pressable className='flex-1 justify-end bg-black/40' onPress={() => setHistoryVisible(false)}>
                    <Pressable className='max-h-[70%] rounded-t-2xl bg-white pb-6' onPress={() => {}}>
                        <View className='flex-row items-center justify-between border-b border-gray-100 px-5 py-4'>
                            <Text className='text-base font-semibold text-gray-900'>历史会话</Text>
                            <Pressable onPress={() => setHistoryVisible(false)}>
                                <Text className='text-sm text-gray-400'>关闭</Text>
                            </Pressable>
                        </View>
                        <FlatList
                            data={conversations}
                            keyExtractor={(item) => String(item.id)}
                            renderItem={({ item }) => (
                                <Pressable
                                    className={`flex-row items-center justify-between px-5 py-3.5 ${
                                        activeConversationId === item.id ? 'bg-blue-50' : ''
                                    }`}
                                    onPress={() => {
                                        setHistoryVisible(false);
                                        void loadConversation(item.id);
                                    }}
                                >
                                    <View className='flex-1'>
                                        <Text className='text-sm text-gray-800' numberOfLines={1}>
                                            {item.title || '新对话'}
                                        </Text>
                                        <Text className='mt-0.5 text-xs text-gray-400'>
                                            {new Date(item.updatedAt).toLocaleString()}
                                        </Text>
                                    </View>
                                    {activeConversationId === item.id ? (
                                        <Text className='text-xs text-blue-600'>当前</Text>
                                    ) : null}
                                </Pressable>
                            )}
                            ListEmptyComponent={
                                <View className='items-center py-10'>
                                    <Text className='text-sm text-gray-400'>暂无历史会话</Text>
                                </View>
                            }
                        />
                    </Pressable>
                </Pressable>
            </Modal>
        </KeyboardAvoidingView>
    );
}
