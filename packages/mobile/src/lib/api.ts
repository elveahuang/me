import { API_BASE_URL } from './config';

export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
    }
}

const TOKEN_KEY = 'wap.session_token';

export function getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
}

/** 登录态 JSON 请求（Bearer token） */
export async function api<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(init?.headers ?? {}),
        },
    });
    if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(res.status, body.error ?? `请求失败 (${res.status})`);
    }
    return (await res.json()) as T;
}

export interface AuthResponse {
    token?: string;
    user?: SessionUser;
    message?: string;
}

export interface SessionUser {
    id: string;
    name: string;
    email: string;
    role: string;
}

export async function signInRequest(email: string, password: string): Promise<AuthResponse> {
    const res = await fetch(`${API_BASE_URL}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    return (await res.json().catch(() => ({}))) as AuthResponse;
}

export async function signUpRequest(name: string, email: string, password: string): Promise<AuthResponse> {
    const res = await fetch(`${API_BASE_URL}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
    });
    return (await res.json().catch(() => ({}))) as AuthResponse;
}
