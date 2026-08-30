import {
    IonButton,
    IonContent,
    IonInput,
    IonItem,
    IonLabel,
    IonList,
    IonPage,
    useIonRouter,
    useIonToast,
} from '@ionic/react';
import { useState } from 'react';
import { useAuth } from '../lib/auth';

export function RegisterPage() {
    const { signUp } = useAuth();
    const router = useIonRouter();
    const [presentToast] = useIonToast();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleRegister = async () => {
        setLoading(true);
        try {
            await signUp(name.trim() || email.split('@')[0] || '用户', email.trim(), password);
            router.push('/agents', 'root');
        } catch (e) {
            void presentToast({ message: e instanceof Error ? e.message : '注册失败', duration: 2500, color: 'danger' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <IonPage>
            <IonContent className='ion-padding'>
                <div style={{ maxWidth: 480, margin: '0 auto', paddingTop: '14vh' }}>
                    <h1 style={{ fontSize: 28, fontWeight: 700 }}>注册</h1>
                    <p style={{ color: 'var(--ion-color-medium)' }}>创建账号，开始与智能体对话。</p>
                    <IonList inset>
                        <IonItem>
                            <IonLabel position='floating'>昵称（可选）</IonLabel>
                            <IonInput value={name} onIonChange={(e) => setName(e.detail.value ?? '')} />
                        </IonItem>
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
                        <IonButton expand='block' disabled={loading} onClick={() => void handleRegister()}>
                            {loading ? '注册中…' : '注册'}
                        </IonButton>
                        <IonButton expand='block' fill='clear' routerLink='/login'>
                            已有账号？直接登录
                        </IonButton>
                    </div>
                </div>
            </IonContent>
        </IonPage>
    );
}
