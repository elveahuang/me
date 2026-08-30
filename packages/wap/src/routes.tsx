import { IonRouterOutlet } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AgentsPage } from './pages/AgentsPage';
import { ChatPage } from './pages/ChatPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { useAuth } from './lib/auth';

/** 登录守卫：未登录跳转 /login */
function RequireAuth({ children }: { children: React.ReactNode }) {
    const { token, loading } = useAuth();

    if (loading) return null;
    if (!token) return <Navigate to='/login' replace />;
    return <>{children}</>;
}

export function AppRoutes() {
    return (
        <IonReactRouter>
            <IonRouterOutlet>
                <Routes>
                    <Route path='/login' element={<LoginPage />} />
                    <Route path='/register' element={<RegisterPage />} />
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
        </IonReactRouter>
    );
}
