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
import { useTranslation } from 'react-i18next';
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
    const { t, i18n } = useTranslation();
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
                setError(e instanceof Error ? e.message : t('common.loadFailed'));
            } finally {
                setLoading(false);
            }
        })();
    }, [token, t]);

    const filtered = agents.filter((a) => a.name.includes(search.trim()));

    const isZh = i18n.language.startsWith('zh');
    const switchLanguage = () => {
        const next = isZh ? 'en' : 'zh';
        localStorage.setItem('app_lang', next);
        void i18n.changeLanguage(next);
        window.location.reload();
    };

    return (
        <IonPage>
            <IonHeader>
                <IonToolbar>
                    <IonTitle>{t('agents.title')}</IonTitle>
                    <IonButtons slot='end'>
                        <IonButton aria-label={isZh ? 'Switch to English' : '切换到中文'} onClick={switchLanguage}>
                            {isZh ? 'EN' : '中'}
                        </IonButton>
                        <IonButton onClick={() => router.push('/membership')}>{t('common.membership')}</IonButton>
                        <IonButton
                            aria-label={t('common.signOut')}
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
                    <IonSearchbar
                        placeholder={t('agents.searchPlaceholder')}
                        value={search}
                        onIonChange={(e) => setSearch(e.detail.value ?? '')}
                    />
                    <p style={{ margin: '0 4px 4px', fontSize: 13, color: 'var(--ion-color-medium)' }}>
                        {t('agents.greeting', { name: user?.name ?? t('common.friend') })}
                    </p>
                </div>
                {loading ? (
                    <p style={{ textAlign: 'center', padding: 32, color: 'var(--ion-color-medium)' }}>{t('common.loading')}</p>
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
                                <IonLabel color='medium'>{t('agents.empty')}</IonLabel>
                            </IonItem>
                        ) : null}
                    </IonList>
                )}
            </IonContent>
        </IonPage>
    );
}
