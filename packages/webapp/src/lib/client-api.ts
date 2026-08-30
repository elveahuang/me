/** 浏览器端 REST 客户端（移动端使用独立实现） */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `请求失败 (${res.status})`);
    }
    return (await res.json()) as T;
}
