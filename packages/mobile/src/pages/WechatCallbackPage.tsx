import { IonButton, IonContent, IonPage, useIonRouter } from '@ionic/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';

/**
 * 微信登录回跳桥页：服务端授权回调后 302 到 /wechat-callback#token=...
 * token 消费在 AuthProvider 启动逻辑里完成，本页只负责展示与跳转。
 */
export function WechatCallbackPage() {
    const { token, loading } = useAuth();
    const router = useIonRouter();
    const { t } = useTranslation();
    const [failed, setFailed] = useState(false);

    // 拿到登录态后回到智能体列表
    useEffect(() => {
        if (!loading && token) {
            router.push('/agents', 'root');
        }
    }, [loading, token, router]);

    // 2 秒后仍无登录态：展示失败提示与返回登录按钮
    useEffect(() => {
        const timer = setTimeout(() => {
            if (loading || !token) setFailed(true);
        }, 2000);
        return () => clearTimeout(timer);
    }, [loading, token]);

    return (
        <IonPage>
            <IonContent className='ion-padding'>
                <div style={{ maxWidth: 480, margin: '0 auto', paddingTop: '30vh', textAlign: 'center' }}>
                    {failed ? (
                        <>
                            <h2 style={{ fontWeight: 700 }}>{t('login.wechatFailedTitle')}</h2>
                            <p style={{ color: 'var(--ion-color-medium)' }}>{t('login.wechatFailedHint')}</p>
                            <IonButton expand='block' style={{ maxWidth: 280, margin: '16px auto 0' }} onClick={() => router.push('/login', 'root')}>
                                {t('login.backToLogin')}
                            </IonButton>
                        </>
                    ) : (
                        <>
                            <h2 style={{ fontWeight: 700 }}>{t('login.wechatPendingTitle')}</h2>
                            <p style={{ color: 'var(--ion-color-medium)' }}>{t('login.wechatPendingHint')}</p>
                        </>
                    )}
                </div>
            </IonContent>
        </IonPage>
    );
}
