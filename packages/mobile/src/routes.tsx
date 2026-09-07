import { IonRouterOutlet } from '@ionic/react';
import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AgentsPage } from './pages/AgentsPage';
import { ChatPage } from './pages/ChatPage';
import { KonstaDemoPage } from './pages/KonstaDemoPage';
import { LoginPage } from './pages/LoginPage';
import { MembershipPage } from './pages/MembershipPage';
import { RegisterPage } from './pages/RegisterPage';
import { WechatCallbackPage } from './pages/WechatCallbackPage';

/** 登录守卫：未登录跳转 /login */
function RequireAuth({ children }: { children: React.ReactNode }) {
    const { token, loading } = useAuth();

    if (loading) return null;
    if (!token) return <Navigate to='/login' replace />;
    return <>{children}</>;
}

export function AppRoutes() {
    return (
        <IonRouterOutlet>
            <Routes>
                <Route path='/login' element={<LoginPage />} />
                <Route path='/register' element={<RegisterPage />} />
                <Route path='/konsta-demo' element={<KonstaDemoPage />} />
                <Route path='/wechat-callback' element={<WechatCallbackPage />} />
                <Route
                    path='/membership'
                    element={
                        <RequireAuth>
                            <MembershipPage />
                        </RequireAuth>
                    }
                />
                <Route
                    path='/agents'
                    element={
                        <RequireAuth>
                            <AgentsPage />
                        </RequireAuth>
                    }
                />
                <Route
                    path='/chat/:agentId'
                    element={
                        <RequireAuth>
                            <ChatPage />
                        </RequireAuth>
                    }
                />
                <Route path='/' element={<Navigate to='/agents' replace />} />
                <Route path='*' element={<Navigate to='/agents' replace />} />
            </Routes>
        </IonRouterOutlet>
    );
}
