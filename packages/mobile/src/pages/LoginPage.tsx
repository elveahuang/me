import { IonButton, IonContent, IonInput, IonItem, IonLabel, IonList, IonPage, useIonRouter, useIonToast } from '@ionic/react';
import { useState } from 'react';
import { useAuth } from '../lib/auth';

export function LoginPage() {
    const { signIn } = useAuth();
    const router = useIonRouter();
    const [presentToast] = useIonToast();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLogin = async () => {
        setLoading(true);
        try {
            await signIn(email.trim(), password);
            router.push('/agents', 'root');
        } catch (e) {
            void presentToast({ message: e instanceof Error ? e.message : '登录失败', duration: 2500, color: 'danger' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <IonPage>
            <IonContent className='ion-padding'>
                <div className='ion-max-width-480' style={{ maxWidth: 480, margin: '0 auto', paddingTop: '18vh' }}>
                    <h1 style={{ fontSize: 28, fontWeight: 700 }}>登录</h1>
                    <p style={{ color: 'var(--ion-color-medium)' }}>与智能体对话，从这里开始。</p>
                    <IonList inset>
                        <IonItem>
                            <IonLabel position='floating'>邮箱</IonLabel>
                            <IonInput type='email' value={email} autocapitalize='off' onIonChange={(e) => setEmail(e.detail.value ?? '')} />
                        </IonItem>
                        <IonItem>
                            <IonLabel position='floating'>密码（至少 8 位）</IonLabel>
                            <IonInput type='password' value={password} onIonChange={(e) => setPassword(e.detail.value ?? '')} />
                        </IonItem>
                    </IonList>
                    <div style={{ padding: '0 16px' }}>
                        <IonButton expand='block' disabled={loading} onClick={() => void handleLogin()}>
                            {loading ? '登录中…' : '登录'}
                        </IonButton>
                        <IonButton expand='block' fill='clear' routerLink='/register'>
                            还没有账号？立即注册
                        </IonButton>
                    </div>
                </div>
            </IonContent>
        </IonPage>
    );
}
