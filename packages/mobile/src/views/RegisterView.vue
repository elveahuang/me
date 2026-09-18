<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { IonContent, IonHeader, IonInput, IonTitle, IonToolbar } from '@ionic/vue';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { authClient } from '../api/auth';
import { useTheme } from '../composables/useTheme';
import PageShell from './PageShell.vue';

const { t } = useI18n();
const { toggleMode } = useTheme();
const router = useRouter();

const name = ref('');
const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
    error.value = '';
    loading.value = true;
    let err: unknown;
    try {
        ({ error: err } = await authClient.signUp.email({
            name: name.value,
            email: email.value,
            password: password.value,
        }));
    } catch (e) {
        // 抛出的网络异常若不复位，注册按钮会永久停在加载态
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
</script>

<template>
    <PageShell>
        <ion-header class="ion-no-border">
            <ion-toolbar>
                <ion-title class="!text-sm font-black">{{ t('nav.register') }}</ion-title>
                <template v-slot:end>
                    <button type="button" class="app-btn app-btn-ghost mr-1 !px-2.5" @click="toggleMode">🌓</button>
                </template>
            </ion-toolbar>
        </ion-header>

        <ion-content>
            <div class="flex min-h-full flex-col justify-center p-5">
                <div class="app-card overflow-hidden">
                    <div class="bg-brand-gradient px-6 py-6 text-center">
                        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-lg font-black">ME</div>
                        <h1 class="mt-3 text-lg font-black">{{ t('nav.register') }}</h1>
                        <p class="mt-1 text-[11px] opacity-85">创建账号，开启智能体之旅</p>
                    </div>

                    <form class="space-y-3.5 p-6" @submit.prevent="submit">
                        <ion-input v-model="name" label="昵称" label-placement="floating" type="text" required autocomplete="nickname" class="app-input" />
                        <ion-input v-model="email" label="邮箱" label-placement="floating" type="email" required autocomplete="email" class="app-input" />
                        <ion-input
                            v-model="password"
                            label="密码（至少 8 位）"
                            label-placement="floating"
                            type="password"
                            required
                            :minlength="8"
                            autocomplete="new-password"
                            class="app-input"
                        />

                        <p v-if="error" class="app-alert app-alert-danger">{{ error }}</p>

                        <button type="submit" :disabled="loading" class="app-btn app-btn-primary w-full !py-3">
                            {{ loading ? t('common.loading') : t('nav.register') }}
                        </button>
                    </form>
                </div>

                <p class="text-muted-2 mt-5 text-center text-xs">
                    已有账号？
                    <router-link to="/login" class="app-link">登录</router-link>
                </p>
            </div>
        </ion-content>
    </PageShell>
</template>
