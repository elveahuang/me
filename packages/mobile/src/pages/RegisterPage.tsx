import { IonButton, IonContent, IonInput, IonItem, IonLabel, IonList, IonPage, useIonRouter, useIonToast } from '@ionic/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';

export function RegisterPage() {
    const { signUp } = useAuth();
    const router = useIonRouter();
    const { t } = useTranslation();
    const [presentToast] = useIonToast();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleRegister = async () => {
        setLoading(true);
        try {
            await signUp(name.trim() || email.split('@')[0] || t('register.defaultName'), email.trim(), password);
            router.push('/agents', 'root');
        } catch (e) {
            void presentToast({ message: e instanceof Error ? e.message : t('register.registerFailed'), duration: 2500, color: 'danger' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <IonPage>
            <IonContent className='ion-padding'>
                <div style={{ maxWidth: 480, margin: '0 auto', paddingTop: '14vh' }}>
                    <h1 style={{ fontSize: 28, fontWeight: 700 }}>{t('register.title')}</h1>
                    <p style={{ color: 'var(--ion-color-medium)' }}>{t('register.subtitle')}</p>
                    <IonList inset>
                        <IonItem>
                            <IonLabel position='floating'>{t('register.nickname')}</IonLabel>
                            <IonInput value={name} onIonChange={(e) => setName(e.detail.value ?? '')} />
                        </IonItem>
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
                        <IonButton expand='block' disabled={loading} onClick={() => void handleRegister()}>
                            {loading ? t('register.registering') : t('register.submit')}
                        </IonButton>
                        <IonButton expand='block' fill='clear' routerLink='/login'>
                            {t('register.loginLink')}
                        </IonButton>
                    </div>
                </div>
            </IonContent>
        </IonPage>
    );
}
