import env from '@/core/env';

export const BASE_URL: string = env.server.app;

export async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
    const response: Response = await fetch(BASE_URL + url, options);
    return await response.json();
}

export async function get<T>(url: string, options?: RequestInit): Promise<T> {
    return fetchApi<T>(url, { method: 'GET', ...options });
}

export async function post<T>(url: string, body: any, options?: RequestInit): Promise<T> {
    return fetchApi<T>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...options,
    });
}
