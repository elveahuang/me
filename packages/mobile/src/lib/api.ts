import { API_BASE_URL } from './config';

export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
    }
}

/** 普通登录态 JSON 请求 */
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
