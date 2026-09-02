import {
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonFooter,
    IonHeader,
    IonList,
    IonModal,
    IonPage,
    IonTextarea,
    IonTitle,
    IonToolbar,
    useIonToast,
} from '@ionic/react';
import { useParams } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../lib/config';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

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
async function streamChat(token: string, body: object, onDelta: (text: string) => void, signal?: AbortSignal) {
    const res = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal,
    });
    if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(res.status, data.error ?? `请求失败 (${res.status})`);
    }

    // 服务端在首次对话时会新建会话并通过该头回传 ID
    const headerConversationId = res.headers.get('x-conversation-id');

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
                if (e instanceof SyntaxError) continue;
                throw e;
            }
        }
    }

    return { conversationId: headerConversationId ? Number(headerConversationId) : null };
}

export function ChatPage() {
    const params = useParams<{ agentId: string }>();
    const agentId = Number(params.agentId);
    const { token } = useAuth();
    const [presentToast] = useIonToast();

    const [agent, setAgent] = useState<Agent | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'streaming'>('loading');
    const [historyVisible, setHistoryVisible] = useState(false);
    const [conversations, setConversations] = useState<ConversationSummary[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
    const conversationIdRef = useRef<number | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    const refreshConversations = useCallback(async () => {
        if (token === null) return;
        try {
            const all = await api<ConversationSummary[]>('/api/conversations', token);
            setConversations(all.filter((c) => c.agentId === agentId));
        } catch {
            // 列表刷新失败不阻塞对话
        }
    }, [agentId, token]);

    const loadConversation = useCallback(
        async (id: number) => {
            if (token === null) return;
            setStatus('loading');
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
                void presentToast({ message: e instanceof Error ? e.message : '加载会话失败', duration: 2500, color: 'danger' });
            } finally {
                setStatus('idle');
            }
        },
        [token, presentToast],
    );

    const startNewConversation = useCallback(() => {
        conversationIdRef.current = null;
        setActiveConversationId(null);
        setMessages([]);
        setInput('');
        setStatus('idle');
    }, []);

    // 加载智能体信息 + 默认续接该智能体最近的会话
    useEffect(() => {
        if (!Number.isInteger(agentId) || agentId <= 0 || token === null) return;
        (async () => {
            try {
                const agents = await api<Agent[]>('/api/agents', token);
                const found = agents.find((a) => a.id === agentId) ?? null;
                setAgent(found);

                const conversations = await api<ConversationSummary[]>('/api/conversations', token);
                const mine = conversations.filter((c) => c.agentId === agentId);
                setConversations(mine);
                const latest = mine[0];
                if (latest) {
                    await loadConversation(latest.id);
                    return;
                }
                setStatus('idle');
            } catch (e) {
                void presentToast({ message: e instanceof Error ? e.message : '加载失败', duration: 2500, color: 'danger' });
                setStatus('idle');
            }
        })();
    }, [agentId, token, loadConversation, presentToast]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const stopStreaming = useCallback(() => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
    }, []);

    const send = async () => {
        const text = input.trim();
        if (!text || status === 'streaming' || token === null) return;
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
                        ...messages.map((m) => ({ id: m.id, role: m.role, parts: [{ type: 'text', text: m.text }] })),
                        { id: userMessage.id, role: 'user', parts: [{ type: 'text', text }] },
                    ],
                },
                (delta) => setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + delta } : m))),
                controller.signal,
            );
            if (newConversationId !== null && conversationIdRef.current === null) {
                conversationIdRef.current = newConversationId;
                setActiveConversationId(newConversationId);
            }
        } catch (e) {
            const aborted = controller.signal.aborted;
            if (!aborted) {
                void presentToast({ message: e instanceof Error ? e.message : '发送失败', duration: 2500, color: 'danger' });
            }
            setMessages((prev) =>
                prev.map((m) =>
                    m.id === assistantId && m.text === ''
                        ? { ...m, text: aborted ? '（已停止生成）' : `⚠️ ${e instanceof Error ? e.message : '发送失败'}` }
                        : m,
                ),
            );
        } finally {
            abortControllerRef.current = null;
            setStatus('idle');
            void refreshConversations();
        }
    };

    return (
        <IonPage>
            <IonHeader>
                <IonToolbar>
                    <IonButtons slot='start'>
                        <IonBackButton defaultHref='/agents' />
                    </IonButtons>
                    <IonTitle>{agent ? `${agent.emoji} ${agent.name}` : '对话'}</IonTitle>
                    <IonButtons slot='end'>
                        {status === 'streaming' ? (
                            <IonButton onClick={stopStreaming}>停止</IonButton>
                        ) : (
                            <>
                                <IonButton onClick={() => { void refreshConversations(); setHistoryVisible(true); }}>
                                    历史
                                </IonButton>
                                <IonButton onClick={startNewConversation}>新对话</IonButton>
                            </>
                        )}
                    </IonButtons>
                </IonToolbar>
            </IonHeader>
            <IonContent>
                {messages.length === 0 && status !== 'loading' ? (
                    <div style={{ textAlign: 'center', paddingTop: 96, color: 'var(--ion-color-medium)' }}>
                        <div style={{ fontSize: 40 }}>{agent?.emoji ?? '🤖'}</div>
                        <p>发送第一条消息开始对话</p>
                    </div>
                ) : null}
                {status === 'loading' ? (
                    <p style={{ textAlign: 'center', paddingTop: 96, color: 'var(--ion-color-medium)' }}>加载会话…</p>
                ) : null}
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {messages.map((message) =>
                        message.role === 'user' ? (
                            <div key={message.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <div
                                    style={{
                                        maxWidth: '80%',
                                        background: 'var(--ion-color-primary)',
                                        color: 'white',
                                        borderRadius: '16px 4px 16px 16px',
                                        padding: '10px 14px',
                                        fontSize: 14,
                                        whiteSpace: 'pre-wrap',
                                    }}
                                >
                                    {message.text}
                                </div>
                            </div>
                        ) : (
                            <div key={message.id} style={{ display: 'flex', justifyContent: 'flex-start' }}>
                                <div
                                    style={{
                                        maxWidth: '85%',
                                        background: 'white',
                                        border: '1px solid var(--ion-color-light-shade, #d7d8da)',
                                        borderRadius: '4px 16px 16px 16px',
                                        padding: '10px 14px',
                                        fontSize: 14,
                                        whiteSpace: 'pre-wrap',
                                    }}
                                >
                                    {message.text || '…'}
                                </div>
                            </div>
                        ),
                    )}
                    <div ref={bottomRef} />
                </div>
            </IonContent>
            <IonFooter>
                <div style={{ display: 'flex', gap: 8, padding: 12, alignItems: 'flex-end' }}>
                    <IonTextarea
                        autoGrow
                        rows={1}
                        placeholder='输入消息…'
                        value={input}
                        disabled={status === 'streaming'}
                        onIonChange={(e) => setInput(e.detail.value ?? '')}
                        style={{ border: '1px solid var(--ion-color-light-shade, #d7d8da)', borderRadius: 12, padding: '6px 12px' }}
                    />
                    <IonButton disabled={status === 'streaming' || input.trim() === ''} onClick={() => void send()}>
                        发送
                    </IonButton>
                </div>
            </IonFooter>

            {/* 历史会话弹层 */}
            <IonModal isOpen={historyVisible} onDidDismiss={() => setHistoryVisible(false)}>
                <IonHeader>
                    <IonToolbar>
                        <IonTitle>历史会话</IonTitle>
                        <IonButtons slot='end'>
                            <IonButton onClick={() => setHistoryVisible(false)}>关闭</IonButton>
                        </IonButtons>
                    </IonToolbar>
                </IonHeader>
                <IonContent>
                    <IonList inset>
                        {conversations.map((c) => (
                            <IonButton
                                key={c.id}
                                expand='block'
                                fill={activeConversationId === c.id ? 'solid' : 'outline'}
                                style={{ margin: '6px 12px' }}
                                onClick={() => {
                                    setHistoryVisible(false);
                                    void loadConversation(c.id);
                                }}
                            >
                                {c.title || '新对话'}
                            </IonButton>
                        ))}
                        {conversations.length === 0 ? (
                            <p style={{ textAlign: 'center', paddingTop: 40, color: 'var(--ion-color-medium)' }}>暂无历史会话</p>
                        ) : null}
                    </IonList>
                </IonContent>
            </IonModal>
        </IonPage>
    );
}
