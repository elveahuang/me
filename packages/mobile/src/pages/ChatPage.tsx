import {
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonFooter,
    IonHeader,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonModal,
    IonPage,
    IonTextarea,
    IonTitle,
    IonToolbar,
    useIonRouter,
    useIonToast,
} from '@ionic/react';
import { trashOutline } from 'ionicons/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { MobileMessageContent } from '../components/MobileGenerativeUI';
import i18n from '../i18n';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { API_BASE_URL } from '../lib/config';

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    reasoning?: string;
    tools?: string[];
    /** 本地占位气泡（失败/停止提示）：仅用于展示，不随下次请求上送入库 */
    local?: boolean;
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

/** 解析 AI SDK UI message stream（SSE），增量回调文本与工具调用提示 */
async function streamChat(
    token: string,
    body: object,
    onDelta: (text: string) => void,
    onToolCall: (toolName: string) => void,
    onReasoning?: (delta: string) => void,
    signal?: AbortSignal,
) {
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
        throw new ApiError(res.status, data.error ?? i18n.t('chat.requestFailed', { status: res.status }));
    }

    // 服务端在首次对话时会新建会话并通过该头回传 ID
    const headerConversationId = res.headers.get('x-conversation-id');

    const reader = res.body?.getReader();
    if (!reader) throw new Error(i18n.t('chat.streamingUnsupported'));
    const decoder = new TextDecoder();

    let finished = false;
    let buffer = '';
    const handleLine = (line: string) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        const chunk = JSON.parse(payload) as {
            type: string;
            delta?: string;
            errorText?: string;
            toolName?: string;
        };
        if (chunk.type === 'text-delta' && chunk.delta) onDelta(chunk.delta);
        if (chunk.type === 'reasoning-delta' && chunk.delta && onReasoning) onReasoning(chunk.delta);
        if (chunk.type === 'tool-input-available' && chunk.toolName) onToolCall(chunk.toolName);
        if (chunk.type === 'finish') finished = true;
        if (chunk.type === 'error') throw new Error(chunk.errorText ?? i18n.t('chat.serverError'));
    };
    const processBuffer = (final: boolean) => {
        const lines = buffer.split(/\r?\n/);
        buffer = final ? '' : (lines.pop() ?? '');
        for (const line of lines) handleLine(line);
    };

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            processBuffer(false);
        }
        // 流结束：flush 解码器并处理没有换行符结尾的最后一行
        buffer += decoder.decode();
        processBuffer(true);
    } catch (e) {
        if (e instanceof SyntaxError) throw new Error(i18n.t('chat.unparsableStream'));
        throw e;
    } finally {
        reader.releaseLock();
    }
    if (!finished) throw new Error(i18n.t('chat.connectionInterrupted'));

    return { conversationId: headerConversationId ? Number(headerConversationId) : null };
}

function CopyAssistantButton({ text }: { text: string }) {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // ignore
        }
    };

    return (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, borderTop: '1px solid #f3f4f6', paddingTop: 6 }}>
            <button
                type='button'
                onClick={handleCopy}
                style={{
                    background: 'none',
                    border: 'none',
                    padding: '2px 6px',
                    fontSize: 11,
                    color: copied ? '#059669' : '#9ca3af',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    cursor: 'pointer',
                }}
            >
                {copied ? `✓ ${t('chat.copied')}` : `📋 ${t('chat.copy')}`}
            </button>
        </div>
    );
}

export function ChatPage() {
    const params = useParams<{ agentId: string }>();
    const agentId = Number(params.agentId);
    const { token } = useAuth();
    const router = useIonRouter();
    const { t } = useTranslation();
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
                    detail.messages.map((m) => {
                        const textParts: string[] = [];
                        const tools: string[] = [];
                        let reasoning = '';
                        for (const p of m.parts) {
                            if (p.type === 'text') {
                                if (p.text) textParts.push(p.text);
                            } else if (p.type === 'reasoning') {
                                if (p.text) reasoning += p.text;
                            } else if (p.type.startsWith('tool-')) {
                                const toolName = p.type.slice(5);
                                if (toolName && !tools.includes(toolName)) {
                                    tools.push(toolName);
                                }
                            }
                        }
                        return {
                            id: m.id,
                            role: m.role === 'assistant' ? 'assistant' : 'user',
                            text: textParts.join('\n'),
                            reasoning: reasoning || undefined,
                            tools: tools.length > 0 ? tools : undefined,
                        };
                    }),
                );
            } catch (e) {
                void presentToast({ message: e instanceof Error ? e.message : t('chat.loadConversationFailed'), duration: 2500, color: 'danger' });
            } finally {
                setStatus('idle');
            }
        },
        [token, presentToast, t],
    );

    const startNewConversation = useCallback(() => {
        conversationIdRef.current = null;
        setActiveConversationId(null);
        setMessages([]);
        setInput('');
        setStatus('idle');
    }, []);

    const handleDeleteConversation = useCallback(
        async (id: number, e: React.MouseEvent) => {
            e.stopPropagation();
            if (token === null) return;
            try {
                await api(`/api/conversations/${id}`, token, { method: 'DELETE' });
                setConversations((prev) => prev.filter((c) => c.id !== id));
                if (conversationIdRef.current === id) {
                    startNewConversation();
                }
                void presentToast({ message: t('chat.deleteSuccess'), duration: 2000, color: 'success' });
            } catch (err) {
                void presentToast({ message: err instanceof Error ? err.message : t('chat.deleteFailed'), duration: 2500, color: 'danger' });
            }
        },
        [token, startNewConversation, presentToast, t],
    );

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
                void presentToast({ message: e instanceof Error ? e.message : t('common.loadFailed'), duration: 2500, color: 'danger' });
                setStatus('idle');
            }
        })();
    }, [agentId, token, loadConversation, presentToast, t]);

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
        setMessages((prev) => [...prev, userMessage, { id: assistantId, role: 'assistant', text: '', reasoning: '', tools: [], local: true }]);
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
                        // 本地占位气泡（错误提示等）仅作展示，不上送入库
                        ...messages.filter((m) => !m.local).map((m) => ({ id: m.id, role: m.role, parts: [{ type: 'text', text: m.text }] })),
                        { id: userMessage.id, role: 'user', parts: [{ type: 'text', text }] },
                    ],
                },
                (delta) => setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + delta, local: false } : m))),
                (toolName) =>
                    setMessages((prev) =>
                        prev.map((m) => {
                            if (m.id !== assistantId) return m;
                            const existing = m.tools ?? [];
                            return {
                                ...m,
                                tools: existing.includes(toolName) ? existing : [...existing, toolName],
                                local: false,
                            };
                        }),
                    ),
                (delta) =>
                    setMessages((prev) =>
                        prev.map((m) => {
                            if (m.id !== assistantId) return m;
                            return { ...m, reasoning: (m.reasoning ?? '') + delta, local: false };
                        }),
                    ),
                controller.signal,
            );
            if (newConversationId !== null && conversationIdRef.current === null) {
                conversationIdRef.current = newConversationId;
                setActiveConversationId(newConversationId);
            }
        } catch (e) {
            const aborted = controller.signal.aborted;
            if (!aborted) {
                const is402 = (e instanceof ApiError && e.status === 402) || (e instanceof Error && e.message.includes('额度'));
                if (is402) {
                    void presentToast({
                        message: e instanceof Error ? e.message : t('chat.sendFailed'),
                        duration: 4500,
                        color: 'warning',
                        buttons: [
                            {
                                text: t('common.membership'),
                                handler: () => {
                                    router.push('/membership');
                                },
                            },
                        ],
                    });
                } else {
                    void presentToast({ message: e instanceof Error ? e.message : t('chat.sendFailed'), duration: 2500, color: 'danger' });
                }
            }
            setMessages((prev) =>
                prev.map((m) =>
                    m.id === assistantId && m.text === ''
                        ? { ...m, text: aborted ? t('chat.stoppedGeneration') : `⚠️ ${e instanceof Error ? e.message : t('chat.sendFailed')}` }
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
                    <IonTitle>{agent ? `${agent.emoji} ${agent.name}` : t('chat.title')}</IonTitle>
                    <IonButtons slot='end'>
                        {status === 'streaming' ? (
                            <IonButton onClick={stopStreaming}>{t('chat.stop')}</IonButton>
                        ) : (
                            <>
                                <IonButton
                                    onClick={() => {
                                        void refreshConversations();
                                        setHistoryVisible(true);
                                    }}
                                >
                                    {t('chat.history')}
                                </IonButton>
                                <IonButton onClick={startNewConversation}>{t('chat.newConversation')}</IonButton>
                            </>
                        )}
                    </IonButtons>
                </IonToolbar>
            </IonHeader>
            <IonContent>
                {messages.length === 0 && status !== 'loading' ? (
                    <div style={{ textAlign: 'center', paddingTop: 96, color: 'var(--ion-color-medium)' }}>
                        <div style={{ fontSize: 40 }}>{agent?.emoji ?? '🤖'}</div>
                        <p>{t('chat.emptyHint')}</p>
                    </div>
                ) : null}
                {status === 'loading' ? (
                    <p style={{ textAlign: 'center', paddingTop: 96, color: 'var(--ion-color-medium)' }}>{t('chat.loadingConversation')}</p>
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
                                        maxWidth: '88%',
                                        background: 'white',
                                        border: '1px solid var(--ion-color-light-shade, #d7d8da)',
                                        borderRadius: '4px 16px 16px 16px',
                                        padding: '10px 14px',
                                        fontSize: 14,
                                    }}
                                >
                                    {message.tools && message.tools.length > 0 ? (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                                            {message.tools.map((tool, idx) => (
                                                <span
                                                    key={idx}
                                                    style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 4,
                                                        borderRadius: 9999,
                                                        border: '1px solid #e5e7eb',
                                                        background: '#f9fafb',
                                                        padding: '2px 8px',
                                                        fontSize: 11,
                                                        color: '#6b7280',
                                                    }}
                                                >
                                                    🔧 {tool}
                                                </span>
                                            ))}
                                        </div>
                                    ) : null}
                                    <MobileMessageContent
                                        text={message.text}
                                        reasoning={message.reasoning}
                                        streaming={status === 'streaming' && message.id.startsWith('a-')}
                                    />
                                    {message.role === 'assistant' && message.local && (message.text.includes('额度') || message.text.includes('402')) ? (
                                        <div style={{ marginTop: 8 }}>
                                            <IonButton size='small' fill='outline' color='warning' onClick={() => router.push('/membership')}>
                                                {t('common.membership')} &rarr;
                                            </IonButton>
                                        </div>
                                    ) : null}
                                    {!message.local && message.text ? <CopyAssistantButton text={message.text} /> : null}
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
                        placeholder={t('chat.inputPlaceholder')}
                        value={input}
                        disabled={status === 'streaming'}
                        onIonChange={(e) => setInput(e.detail.value ?? '')}
                        style={{ border: '1px solid var(--ion-color-light-shade, #d7d8da)', borderRadius: 12, padding: '6px 12px' }}
                    />
                    <IonButton disabled={status === 'streaming' || input.trim() === ''} onClick={() => void send()}>
                        {t('chat.send')}
                    </IonButton>
                </div>
            </IonFooter>

            {/* 历史会话弹层 */}
            <IonModal isOpen={historyVisible} onDidDismiss={() => setHistoryVisible(false)}>
                <IonHeader>
                    <IonToolbar>
                        <IonTitle>{t('chat.historyTitle')}</IonTitle>
                        <IonButtons slot='end'>
                            <IonButton onClick={() => setHistoryVisible(false)}>{t('common.close')}</IonButton>
                        </IonButtons>
                    </IonToolbar>
                </IonHeader>
                <IonContent>
                    <IonList inset>
                        {conversations.map((c) => (
                            <IonItem
                                key={c.id}
                                button
                                detail={false}
                                color={activeConversationId === c.id ? 'primary' : undefined}
                                onClick={() => {
                                    setHistoryVisible(false);
                                    void loadConversation(c.id);
                                }}
                            >
                                <IonLabel>
                                    <h2>{c.title || t('chat.newConversation')}</h2>
                                    {c.updatedAt ? <p>{new Date(c.updatedAt).toLocaleString()}</p> : null}
                                </IonLabel>
                                <IonButton
                                    slot='end'
                                    fill='clear'
                                    color={activeConversationId === c.id ? 'light' : 'medium'}
                                    size='small'
                                    onClick={(e) => void handleDeleteConversation(c.id, e)}
                                    aria-label={t('chat.deleteConversation')}
                                >
                                    <IonIcon icon={trashOutline} slot='icon-only' />
                                </IonButton>
                            </IonItem>
                        ))}
                        {conversations.length === 0 ? (
                            <p style={{ textAlign: 'center', paddingTop: 40, color: 'var(--ion-color-medium)' }}>{t('chat.noHistory')}</p>
                        ) : null}
                    </IonList>
                </IonContent>
            </IonModal>
        </IonPage>
    );
}
