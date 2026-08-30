import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { API_BASE_URL } from './config';
import { api } from './api';

const TOKEN_KEY = 'auth.session_token';

export interface SessionUser {
    id: string;
    name: string;
    email: string;
    role: string;
}

interface AuthContextValue {
    token: string | null;
    user: SessionUser | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (name: string, email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthResponse {
    token?: string;
    user?: SessionUser;
    message?: string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [token, setToken] = useState<string | null>(null);
    const [user, setUser] = useState<SessionUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const stored = await SecureStore.getItemAsync(TOKEN_KEY);
                if (stored) {
                    try {
                        const me = await api<{ user: SessionUser }>('/api/me', stored);
                        setToken(stored);
                        setUser(me.user);
                    } catch {
                        await SecureStore.deleteItemAsync(TOKEN_KEY);
                    }
                }
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const persist = async (data: AuthResponse) => {
        if (!data.token || !data.user) throw new Error(data.message ?? '登录凭据无效');
        await SecureStore.setItemAsync(TOKEN_KEY, data.token);
        setToken(data.token);
        setUser(data.user);
    };

    const value = useMemo<AuthContextValue>(
        () => ({
            token,
            user,
            loading,
            signIn: async (email, password) => {
                const res = await fetch(`${API_BASE_URL}/api/auth/sign-in/email`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ email, password }),
                });
                const data = (await res.json().catch(() => ({}))) as AuthResponse;
                if (!res.ok) throw new Error(data.message ?? '登录失败，请检查邮箱和密码');
                await persist(data);
            },
            signUp: async (name, email, password) => {
                const res = await fetch(`${API_BASE_URL}/api/auth/sign-up/email`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ name, email, password }),
                });
                const data = (await res.json().catch(() => ({}))) as AuthResponse;
                if (!res.ok) throw new Error(data.message ?? '注册失败，请稍后再试');
                await persist(data);
            },
            signOut: async () => {
                try {
                    await api('/api/auth/sign-out', token, { method: 'POST' });
                } catch {
                    // 忽略登出接口失败，本地状态照常清理
                }
                await SecureStore.deleteItemAsync(TOKEN_KEY);
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
