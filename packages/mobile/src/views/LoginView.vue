<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { IonContent, IonHeader, IonInput, IonTitle, IonToolbar } from '@ionic/vue';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { api, apiUrl, authClient } from '../api/auth';
import { useTheme } from '@/composables/useTheme';
import PageShell from './PageShell.vue';

const { t } = useI18n();
const { toggleMode } = useTheme();
const router = useRouter();

const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);
const wechat = ref<{ enabled: boolean; redirectUrl?: string | null }>({ enabled: false });

onMounted(async () => {
    try {
        wechat.value = await api<{ enabled: boolean; redirectUrl?: string | null }>('/api/auth/wechat/status?client=mobile');
    } catch {
        wechat.value = { enabled: false };
    }
});

async function submit() {
    error.value = '';
    loading.value = true;
    let err: unknown;
    try {
        ({ error: err } = await authClient.signIn.email({ email: email.value, password: password.value }));
    } catch (e) {
        // 网络/运行时异常若抛出，不复位 loading 会让登录按钮永久停在加载态
        err = e;
    } finally {
        loading.value = false;
    }
    if (err) {
        error.value = extractApiError(err, t('common.error'));
        return;
    }
    router.replace('/home');
}

function loginWithWechat() {
    if (!wechat.value.redirectUrl) {
        error.value = t('auth.wechatNoRedirect');
        return;
    }
    // 原生壳下 VITE_API_BASE 指向远端后端，相对地址会落到 capacitor://localhost 而 404，需用 apiUrl 拼接
    window.location.href = apiUrl(`/api/auth/wechat?client=mobile&redirect=${encodeURIComponent(wechat.value.redirectUrl)}`);
}
</script>

<template>
    <PageShell>
        <ion-content>
            <div class="flex min-h-full flex-col justify-center p-5">
                <div class="app-card overflow-hidden">
                    <div class="bg-brand-gradient px-6 py-6 text-center">
                        <div class="on-brand-tile mx-auto flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-black">ME</div>
                        <h1 class="mt-3 text-lg font-black">{{ t('nav.login') }}</h1>
                        <p class="mt-1 text-[11px] opacity-85">{{ t('auth.welcomeBack', { app: t('common.appName') }) }}</p>
                    </div>

                    <form class="space-y-3.5 p-6" @submit.prevent="submit">
                        <ion-input
                            v-model="email"
                            :label="t('auth.email')"
                            label-placement="floating"
                            type="email"
                            required
                            autocomplete="email"
                            class="app-input"
                        />
                        <ion-input
                            v-model="password"
                            :label="t('auth.password')"
                            label-placement="floating"
                            type="password"
                            required
                            autocomplete="current-password"
                            class="app-input"
                        />

                        <p v-if="error" class="app-alert app-alert-danger">{{ error }}</p>

                        <button type="submit" :disabled="loading" class="app-btn app-btn-primary w-full !py-3">
                            {{ loading ? t('common.loading') : t('nav.login') }}
                        </button>
                    </form>
                </div>

                <button v-if="wechat.enabled" type="button" class="app-btn app-btn-outline mt-4 w-full py-3!" @click="loginWithWechat">
                    <span>💬</span>
                    <span>{{ t('auth.wechatLogin') }}</span>
                </button>

                <p class="text-muted-2 mt-5 text-center text-xs">
                    {{ t('auth.noAccount') }}
                    <router-link to="/register" class="app-link">{{ t('nav.register') }}</router-link>
                </p>
            </div>
        </ion-content>
    </PageShell>
</template>
