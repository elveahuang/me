import { resolveSession, ssrCookieHeaders } from '~/utils/auth-client';

export default defineNuxtRouteMiddleware(async (to) => {
    const outcome = await resolveSession(ssrCookieHeaders());
    // 抖动/5xx 不等于登出：服务端仍是鉴权权威，放行后由页面自己的请求暴露真实故障
    if (outcome.status !== 'anonymous') return;
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`);
});
