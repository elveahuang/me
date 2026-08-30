import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, getToken, SessionUser, setToken, signInRequest, signUpRequest } from './api';

interface AuthContextValue {
    token: string | null;
    user: SessionUser | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (name: string, email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [token, setTokenState] = useState<string | null>(null);
    const [user, setUser] = useState<SessionUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            const stored = getToken();
            if (stored) {
                try {
                    const me = await api<{ user: SessionUser }>('/api/me', stored);
                    setTokenState(stored);
                    setUser(me.user);
                } catch {
                    setToken(null);
                }
            }
            setLoading(false);
        })();
    }, []);

    const value = useMemo<AuthContextValue>(
        () => ({
            token,
            user,
            loading,
            signIn: async (email, password) => {
                const data = await signInRequest(email, password);
                if (!data.token || !data.user) throw new Error(data.message ?? '登录失败，请检查邮箱和密码');
                setToken(data.token);
                setTokenState(data.token);
                setUser(data.user);
            },
            signUp: async (name, email, password) => {
                const data = await signUpRequest(name, email, password);
                if (!data.token || !data.user) throw new Error(data.message ?? '注册失败，请稍后再试');
                setToken(data.token);
                setTokenState(data.token);
                setUser(data.user);
            },
            signOut: async () => {
                try {
                    await api('/api/auth/sign-out', token, { method: 'POST' });
                } catch {
                    // 忽略登出接口失败
                }
                setToken(null);
                setUser(null);
            },
        }),
        [token, user, loading],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
    return ctx;
}
