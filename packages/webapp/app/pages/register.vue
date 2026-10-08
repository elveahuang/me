<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ middleware: 'guest' });

const { t } = useI18n();

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
        // 抛出的网络异常若不复位，提交按钮会永久停在加载态
        err = e;
    } finally {
        loading.value = false;
    }
    if (err) {
        error.value = extractApiError(err, t('common.error'));
        return;
    }
    await navigateTo('/');
}
</script>

<template>
    <div class="mx-auto mt-10 w-full max-w-md">
        <div class="app-card overflow-hidden">
            <div class="bg-brand-gradient px-8 py-7 text-center">
                <div class="on-brand-tile mx-auto flex h-12 w-12 items-center justify-center rounded-2xl text-xl font-black backdrop-blur-sm">ME</div>
                <h1 class="mt-3 text-xl font-black">{{ t('nav.register') }}</h1>
                <p class="mt-1 text-xs opacity-85">{{ t('auth.registerSlogan') }}</p>
            </div>

            <div class="p-8">
                <form class="space-y-4" @submit.prevent="submit">
                    <div>
                        <label for="register-name" class="text-soft mb-1.5 block text-xs font-bold">{{ t('auth.nickname') }}</label>
                        <input
                            id="register-name"
                            v-model="name"
                            type="text"
                            required
                            autocomplete="nickname"
                            class="app-input"
                            :placeholder="t('auth.nicknamePlaceholder')"
                        />
                    </div>
                    <div>
                        <label for="register-email" class="text-soft mb-1.5 block text-xs font-bold">{{ t('profile.email') }}</label>
                        <input id="register-email" v-model="email" type="email" required autocomplete="email" class="app-input" placeholder="you@example.com" />
                    </div>
                    <div>
                        <label for="register-password" class="text-soft mb-1.5 block text-xs font-bold">{{ t('auth.passwordMin8') }}</label>
                        <input
                            id="register-password"
                            v-model="password"
                            type="password"
                            required
                            minlength="8"
                            autocomplete="new-password"
                            class="app-input"
                            placeholder="••••••••"
                        />
                    </div>

                    <p v-if="error" class="app-alert app-alert-danger">{{ error }}</p>

                    <button type="submit" :disabled="loading" class="app-btn app-btn-primary w-full !py-3">
                        {{ loading ? t('common.loading') : t('nav.register') }}
                    </button>
                </form>

                <p class="text-muted-2 mt-6 text-center text-xs">
                    {{ t('auth.haveAccount') }}
                    <NuxtLink to="/login" class="app-link">{{ t('nav.login') }}</NuxtLink>
                </p>
            </div>
        </div>
    </div>
</template>
