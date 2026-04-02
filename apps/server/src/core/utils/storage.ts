import { isEmpty } from 'es-toolkit/compat';

export const ACCESS_TOKEN_KEY = 'ACCESS_TOKEN';

export const REFRESH_TOKEN_KEY = 'REFRESH_TOKEN';

export function getItem(key: string): string {
    return localStorage.getItem(key) ?? '';
}

export function setItem(key: string, val: string): void {
    if (!isEmpty(val)) {
        localStorage.setItem(key, val);
    } else {
        removeItem(key);
    }
}

export function removeItem(key: string): void {
    localStorage.removeItem(key);
}

export function getAccessToken(): string {
    return getItem(ACCESS_TOKEN_KEY) ?? '';
}

export function setAccessToken(val: string): void {
    setItem(ACCESS_TOKEN_KEY, val);
}

export function removeAccessToken(): void {
    removeItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string {
    return getItem(REFRESH_TOKEN_KEY) ?? '';
}

export function setRefreshToken(val: string): void {
    setItem(REFRESH_TOKEN_KEY, val);
}

export function removeRefreshToken(): void {
    removeItem(REFRESH_TOKEN_KEY);
}

export function clear(): void {
    localStorage.clear();
}

export const storage = {
    getItem,
    setItem,
    removeItem,
    getAccessToken,
    setAccessToken,
    removeAccessToken,
    getRefreshToken,
    setRefreshToken,
    removeRefreshToken,
    clear,
};

export default storage;
