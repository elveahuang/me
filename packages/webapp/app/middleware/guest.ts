import { fetchSession, ssrCookieHeaders } from '~/utils/auth-client';

export default defineNuxtRouteMiddleware(async () => {
    const session = await fetchSession(ssrCookieHeaders());
    if (session) {
        return navigateTo('/chat');
    }
});
