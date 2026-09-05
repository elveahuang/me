import {
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonPage,
    IonSearchbar,
    IonTitle,
    IonToolbar,
    useIonRouter,
} from '@ionic/react';
import { logOutOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

interface Agent {
    id: number;
    name: string;
    emoji: string;
    description: string;
    model: string;
}

export function AgentsPage() {
    const { token, user, signOut } = useAuth();
    const router = useIonRouter();
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const list = await api<Agent[]>('/api/agents', token);
                setAgents(list);
            } catch (e) {
                setError(e instanceof Error ? e.message : '加载失败');
            } finally {
                setLoading(false);
            }
        })();
    }, [token]);

    const filtered = agents.filter((a) => a.name.includes(search.trim()));

    return (
        <IonPage>
            <IonHeader>
                <IonToolbar>
                    <IonTitle>智能体</IonTitle>
                    <IonButtons slot='end'>
                        <IonButton
                            onClick={() => {
                                void signOut().then(() => router.push('/login', 'root'));
                            }}
                        >
                            <IonIcon slot='icon-only' icon={logOutOutline} />
                        </IonButton>
                    </IonButtons>
                </IonToolbar>
            </IonHeader>
            <IonContent>
                <div style={{ padding: '8px 12px 0' }}>
                    <IonSearchbar placeholder='搜索智能体' value={search} onIonChange={(e) => setSearch(e.detail.value ?? '')} />
                    <p style={{ margin: '0 4px 4px', fontSize: 13, color: 'var(--ion-color-medium)' }}>你好，{user?.name ?? '朋友'}，选择一个智能体开始对话</p>
                </div>
                {loading ? (
                    <p style={{ textAlign: 'center', padding: 32, color: 'var(--ion-color-medium)' }}>加载中…</p>
                ) : error ? (
                    <p style={{ textAlign: 'center', padding: 32, color: 'var(--ion-color-danger)' }}>{error}</p>
                ) : (
                    <IonList inset>
                        {filtered.map((agent) => (
                            <IonItem key={agent.id} button routerLink={`/chat/${agent.id}`} detail>
                                <span slot='start' style={{ fontSize: 26 }}>
                                    {agent.emoji}
                                </span>
                                <IonLabel>
                                    <h2>{agent.name}</h2>
                                    <p>{agent.description || agent.model}</p>
                                </IonLabel>
                            </IonItem>
                        ))}
                        {filtered.length === 0 ? (
                            <IonItem lines='none'>
                                <IonLabel color='medium'>暂无可用智能体</IonLabel>
                            </IonItem>
                        ) : null}
                    </IonList>
                )}
            </IonContent>
        </IonPage>
    );
}
