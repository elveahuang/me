<script setup lang="ts">
import { extractApiError } from '@contract';
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

async function submit() {
    error.value = '';
    loading.value = true;
    const { error: err } = await authClient.signIn.email({ email: email.value, password: password.value });
    loading.value = false;
    if (err) {
        error.value = extractApiError(err, t('common.error'));
        return;
    }
    await navigateTo((route.query.redirect as string) || '/chat');
}

function loginWithWechat() {
    const redirect = encodeURIComponent((route.query.redirect as string) || '/chat');
    window.location.href = `/api/auth/wechat?redirect=${redirect}`;
}
</script>

<template>
    <div class="mx-auto mt-10 w-full max-w-md">
        <div class="app-card overflow-hidden">
            <!-- 顶部品牌区 -->
            <div class="bg-brand-gradient px-8 py-7 text-center">
                <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-xl font-black backdrop-blur-sm">EE</div>
                <h1 class="mt-3 text-xl font-black">{{ t('nav.login') }}</h1>
                <p class="mt-1 text-xs opacity-85">欢迎回到 {{ t('common.appName') }}</p>
            </div>

            <div class="p-8">
                <form class="space-y-4" @submit.prevent="submit">
                    <div>
                        <label class="text-soft mb-1.5 block text-xs font-bold">{{ t('profile.email') }}</label>
                        <input v-model="email" type="email" required autocomplete="email" class="app-input" placeholder="you@example.com" />
                    </div>
                    <div>
                        <label class="text-soft mb-1.5 block text-xs font-bold">密码</label>
                        <input v-model="password" type="password" required autocomplete="current-password" class="app-input" placeholder="••••••••" />
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
                        <span>微信一键登录</span>
                    </button>
                </div>

                <p class="text-muted-2 mt-6 text-center text-xs">
                    还没有账号？
                    <NuxtLink to="/register" class="app-link">{{ t('nav.register') }}</NuxtLink>
                </p>
            </div>
        </div>
    </div>
</template>
