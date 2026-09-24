<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ middleware: 'guest' });

const { t } = useI18n();

const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);
const wechatEnabled = ref(false);
const route = useRoute();

onMounted(async () => {
    try {
        const res = await $fetch<{ enabled: boolean }>('/api/auth/wechat/status');
        wechatEnabled.value = res.enabled;
    } catch {
        wechatEnabled.value = false;
    }
});

/** 只接受站内相对路径，拒绝 //host 与 /\host 这类可跳外域的写法 */
function safeRedirect(target: unknown, fallback = '/'): string {
    if (typeof target !== 'string') return fallback;
    if (target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/\\')) return target;
    return fallback;
}

async function submit() {
    error.value = '';
    loading.value = true;
    let err: unknown;
    try {
        ({ error: err } = await authClient.signIn.email({ email: email.value, password: password.value }));
    } catch (e) {
        // 网络/运行时异常也要复位 loading，否则提交按钮永久停在加载态
        err = e;
    } finally {
        loading.value = false;
    }
    if (err) {
        error.value = extractApiError(err, t('common.error'));
        return;
    }
    await navigateTo(safeRedirect(route.query.redirect));
}

function loginWithWechat() {
    // 与服务端 wechat.get 的 UA 门同口径，但提前到就地提示：非微信浏览器跳过去只会
    // 整页落在 /api/auth/wechat 的错误响应上、丢失登录页上下文（在微信内打开时不受影响）
    if (!/MicroMessenger/i.test(navigator.userAgent)) {
        error.value = t('auth.wechatBrowserOnly');
        return;
    }
    const redirect = encodeURIComponent(safeRedirect(route.query.redirect));
    window.location.href = `/api/auth/wechat?redirect=${redirect}`;
}
</script>

<template>
    <div class="mx-auto mt-10 w-full max-w-md">
        <div class="app-card overflow-hidden">
            <!-- 顶部品牌区 -->
            <div class="bg-brand-gradient px-8 py-7 text-center">
                <div class="on-brand-tile mx-auto flex h-12 w-12 items-center justify-center rounded-2xl text-xl font-black backdrop-blur-sm">ME</div>
                <h1 class="mt-3 text-xl font-black">{{ t('nav.login') }}</h1>
                <p class="mt-1 text-xs opacity-85">{{ t('auth.welcomeBack', { app: t('common.appName') }) }}</p>
            </div>

            <div class="p-8">
                <form class="space-y-4" @submit.prevent="submit">
                    <div>
                        <label for="login-email" class="text-soft mb-1.5 block text-xs font-bold">{{ t('profile.email') }}</label>
                        <input id="login-email" v-model="email" type="email" required autocomplete="email" class="app-input" placeholder="you@example.com" />
                    </div>
                    <div>
                        <label for="login-password" class="text-soft mb-1.5 block text-xs font-bold">{{ t('auth.password') }}</label>
                        <input
                            id="login-password"
                            v-model="password"
                            type="password"
                            required
                            autocomplete="current-password"
                            class="app-input"
                            placeholder="••••••••"
                        />
                    </div>

                    <p v-if="error" class="app-alert app-alert-danger">{{ error }}</p>

                    <button type="submit" :disabled="loading" class="app-btn app-btn-primary w-full !py-3">
                        {{ loading ? t('common.loading') : t('nav.login') }}
                    </button>
                </form>

                <div v-if="wechatEnabled" class="mt-6">
                    <div class="relative my-4">
                        <div class="absolute inset-0 flex items-center"><div class="app-divider w-full border-t-0" /></div>
                        <div class="relative flex justify-center text-[10px] uppercase">
                            <span class="text-faint px-2" style="background-color: var(--surface)">OR</span>
                        </div>
                    </div>
                    <button type="button" class="app-btn app-btn-outline w-full !py-3" @click="loginWithWechat">
                        <span>💬</span>
                        <span>{{ t('auth.wechatLogin') }}</span>
                    </button>
                </div>

                <p class="text-muted-2 mt-6 text-center text-xs">
                    {{ t('auth.noAccount') }}
                    <NuxtLink to="/register" class="app-link">{{ t('nav.register') }}</NuxtLink>
                </p>
            </div>
        </div>
    </div>
</template>
