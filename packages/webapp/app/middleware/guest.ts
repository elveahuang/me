import { resolveSession, ssrCookieHeaders } from '~/utils/auth-client';

export default defineNuxtRouteMiddleware(async () => {
    const outcome = await resolveSession(ssrCookieHeaders());
    // 只有确定已登录才踢回首页；抖动/5xx 时留在登录页，与 auth/admin 守卫同样走 resolveSession
    if (outcome.status === 'signed-in') {
        return navigateTo('/');
    }
});
