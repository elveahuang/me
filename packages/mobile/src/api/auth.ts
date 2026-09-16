/**
 * 兼容入口：移动端所有接口调用统一收敛到 ./client。
 * 保留本文件名，避免历史 import 路径失效。
 */
export { api, apiUrl, authClient, extractApiError, fetchSession, getToken, setToken, signOut, type SessionPayload } from './client';
