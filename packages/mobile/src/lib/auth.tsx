import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, signInRequest, signUpRequest } from './api';
import type { SessionUser } from './api';

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
            // 微信登录回跳：URL hash 携带 token=...（服务端 302 回跳注入），优先消费。
            // 走与 signIn 相同的存储逻辑（setToken + GET /api/me 拉用户），然后清掉 hash 避免刷新重复消费。
            const hash = window.location.hash;
            const hashToken = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('token');
            if (hashToken) {
                window.history.replaceState(null, '', window.location.pathname + window.location.search);
                try {
                    const me = await api<{ user: SessionUser }>('/api/me', hashToken);
                    setToken(hashToken);
                    setTokenState(hashToken);
                    setUser(me.user);
                } catch {
                    setToken(null);
                }
                setLoading(false);
                return;
            }

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
