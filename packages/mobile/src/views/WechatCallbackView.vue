<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { IonContent, IonPage, IonSpinner } from '@ionic/vue';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchSession, setToken } from '../api/auth';

const router = useRouter();
const errorMessage = ref('');
const syncing = ref(false);
const token = ref<string | null>(null);

/** 从回跳地址的 hash/query 中取出服务端下发的 session token */
function readToken(): string | null {
    const hash = window.location.hash || '';
    const match = hash.match(/token=([^&]+)/);
    const params = new URLSearchParams(window.location.search);
    return match ? decodeURIComponent(match[1]!) : params.get('token');
}

/**
 * 微信授权回跳页。
 * 服务端回跳地址形如 `<mobile>/wechat-callback#token=<sessionToken>`，
 * 这里把 token 存进本地（原生壳用 bearer 认证），随后校验会话并进入首页。
 * get-session 可能因瞬时网络抖动失败，故保留 token 并允许重试，而不是直接判定登录失败。
 */
async function sync() {
    errorMessage.value = '';
    syncing.value = true;
    try {
        if (token.value) {
            setToken(token.value);
            // 清掉地址栏里的 token，避免留在历史记录中
            window.history.replaceState(null, '', window.location.pathname);
        }
        const session = await fetchSession();
        if (session?.user) {
            router.replace('/home');
        } else {
            errorMessage.value = '登录状态同步失败，请重试或重新登录';
        }
    } catch (e) {
        errorMessage.value = extractApiError(e, '微信登录失败');
    } finally {
        syncing.value = false;
    }
}

onMounted(() => {
    token.value = readToken();
    void sync();
});
</script>

<template>
    <ion-page>
        <ion-content>
            <div class="flex h-full flex-col items-center justify-center p-8 text-center">
                <template v-if="syncing">
                    <ion-spinner name="crescent" class="mb-4" />
                    <p class="text-soft text-sm font-medium">正在同步微信登录状态…</p>
                </template>
                <template v-else-if="errorMessage">
                    <div class="app-alert app-alert-danger max-w-xs">
                        <span class="text-3xl">⚠️</span>
                        <p class="mt-3 text-sm font-semibold">{{ errorMessage }}</p>
                        <button type="button" class="app-btn app-btn-primary mt-4 w-full" @click="sync">重试</button>
                        <router-link to="/login" class="app-btn app-btn-outline mt-2 w-full">返回登录</router-link>
                    </div>
                </template>
            </div>
        </ion-content>
    </ion-page>
</template>
