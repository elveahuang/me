import { fetchSession, ssrCookieHeaders } from '~/utils/auth-client';

export default defineNuxtRouteMiddleware(async (to) => {
    const session = await fetchSession(ssrCookieHeaders());
    if (!session) {
        return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`);
    }
});
