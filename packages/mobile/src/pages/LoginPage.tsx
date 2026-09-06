import { IonButton, IonContent, IonInput, IonItem, IonLabel, IonList, IonPage, useIonRouter, useIonToast } from '@ionic/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { API_BASE_URL } from '../lib/config';

export function LoginPage() {
    const { signIn } = useAuth();
    const router = useIonRouter();
    const { t } = useTranslation();
    const [presentToast] = useIonToast();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [wechatEnabled, setWechatEnabled] = useState(false);

    // 微信登录可用性（公开接口）：enabled 为 true 才显示微信登录按钮
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/auth/wechat/status?client=mobile`);
                const data = (await res.json().catch(() => ({}))) as { enabled?: boolean };
                if (!cancelled) setWechatEnabled(Boolean(data.enabled));
            } catch {
                // 检测失败时不显示微信登录
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const handleLogin = async () => {
        setLoading(true);
        try {
            await signIn(email.trim(), password);
            router.push('/agents', 'root');
        } catch (e) {
            void presentToast({ message: e instanceof Error ? e.message : t('login.loginFailed'), duration: 2500, color: 'danger' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <IonPage>
            <IonContent className='ion-padding'>
                <div className='ion-max-width-480' style={{ maxWidth: 480, margin: '0 auto', paddingTop: '18vh' }}>
                    <h1 style={{ fontSize: 28, fontWeight: 700 }}>{t('login.title')}</h1>
                    <p style={{ color: 'var(--ion-color-medium)' }}>{t('login.subtitle')}</p>
                    <IonList inset>
                        <IonItem>
                            <IonLabel position='floating'>{t('common.email')}</IonLabel>
                            <IonInput type='email' value={email} autocapitalize='off' onIonChange={(e) => setEmail(e.detail.value ?? '')} />
                        </IonItem>
                        <IonItem>
                            <IonLabel position='floating'>{t('common.passwordLabel')}</IonLabel>
                            <IonInput type='password' value={password} onIonChange={(e) => setPassword(e.detail.value ?? '')} />
                        </IonItem>
                    </IonList>
                    <div style={{ padding: '0 16px' }}>
                        <IonButton expand='block' disabled={loading} onClick={() => void handleLogin()}>
                            {loading ? t('login.loggingIn') : t('login.submit')}
                        </IonButton>
                        {wechatEnabled ? (
                            <IonButton
                                expand='block'
                                fill='outline'
                                color='success'
                                style={{ marginTop: 8 }}
                                onClick={() => {
                                    window.location.href = `${API_BASE_URL}/api/auth/wechat?redirect=${encodeURIComponent(window.location.origin + '/wechat-callback')}`;
                                }}
                            >
                                {t('login.wechatLogin')}
                            </IonButton>
                        ) : null}
                        <IonButton expand='block' fill='clear' routerLink='/register'>
                            {t('login.registerLink')}
                        </IonButton>
                    </div>
                </div>
            </IonContent>
        </IonPage>
    );
}
