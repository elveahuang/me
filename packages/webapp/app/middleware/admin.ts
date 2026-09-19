import { resolveSession, ssrCookieHeaders } from '~/utils/auth-client';

export default defineNuxtRouteMiddleware(async (to) => {
    const outcome = await resolveSession(ssrCookieHeaders());
    if (outcome.status === 'error') return;
    if (outcome.status === 'anonymous') {
        return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`);
    }
    if (outcome.session.user.role !== 'admin') {
        return navigateTo('/chat');
    }
});
