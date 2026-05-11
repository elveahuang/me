import { User } from '@/core/types/user';
import { postJson } from '@/core/utils/http';

/**
 * 用户登录
 */
export interface LoginApiResult {
    jwt: string;
    user: User;
}

export interface LoginApiParams {
    username?: string;
    password?: string;
}

export async function loginApi(params: LoginApiParams): Promise<LoginApiResult> {
    return postJson<LoginApiResult>('/api/auth/local', { identifier: params.username, password: params.password });
}

/**
 * 用户登录
 */
export interface RegisterApiResult {
    token_type: string;
    access_token: string;
    refresh_token: string;
    expires_in: number;
}

export interface RegisterApiParams {
    username: string;
    email: string;
    password: string;
}

export async function registerApi(params: RegisterApiParams): Promise<RegisterApiResult> {
    return postJson<RegisterApiResult>('/api/auth/local/register', params);
}

/**
 * 用户退出登录
 */
export async function logoutApi(): Promise<void> {
    return Promise.resolve();
}
