<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { IonButtons, IonContent, IonHeader, IonInput, IonModal, IonTitle, IonToolbar } from '@ionic/vue';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { authClient } from '../api/auth';

/**
 * 修改密码（个人中心）。
 *
 * 走 Better Auth 内置的 /api/auth/change-password（需要当前密码，无需服务端新代码）。
 * revokeOtherSessions 固定为 true：其他设备的旧会话一并作废；当前会话由服务端换发，
 * bearer 插件的 onSuccess 会自动捕获 set-auth-token 更新本地 token，不会被登出。
 */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();

const PASSWORD_MIN_LENGTH = 8;

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const submitting = ref(false);
const error = ref('');
/** 成功态在弹层内呈现：关闭后提示会随组件卸载丢失，弹层里给出明确的完成反馈 */
const done = ref(false);

/** 每次打开都重置表单：关闭后残留的输入在下一次打开时会造成误提交 */
watch(
    () => props.open,
    (open) => {
        if (open) {
            currentPassword.value = '';
            newPassword.value = '';
            confirmPassword.value = '';
            error.value = '';
            done.value = false;
        }
    },
);

/** better-auth 的错误码 → 本地化文案；其余交给 extractApiError 兜底 */
function describeError(code: string | undefined, e: unknown): string {
    if (code === 'INVALID_PASSWORD') return t('profile.errorInvalidPassword');
    if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') return t('common.passwordMinLength');
    return extractApiError(e, t('common.error'));
}

async function submit() {
    error.value = '';
    // 与 Better Auth 默认的 password.minLength（8）保持一致，服务端还会再校验一次
    if (newPassword.value.length < PASSWORD_MIN_LENGTH) {
        error.value = t('common.passwordMinLength');
        return;
    }
    if (newPassword.value !== confirmPassword.value) {
        error.value = t('common.passwordMismatch');
        return;
    }
    submitting.value = true;
    try {
        const { error: authError } = await authClient.changePassword({
            currentPassword: currentPassword.value,
            newPassword: newPassword.value,
            revokeOtherSessions: true,
        });
        if (authError) {
            error.value = describeError(authError.code, authError);
            return;
        }
        done.value = true;
    } catch (e) {
        error.value = describeError(undefined, e);
    } finally {
        submitting.value = false;
    }
}
</script>

<template>
    <ion-modal :is-open="open" @did-dismiss="emit('close')">
        <ion-header class="ion-no-border">
            <ion-toolbar>
                <ion-title class="!text-sm font-black">{{ t('profile.changePassword') }}</ion-title>
                <template v-slot:end>
                    <ion-buttons>
                        <button type="button" class="app-btn app-btn-ghost" :aria-label="t('common.close')" @click="emit('close')">✕</button>
                    </ion-buttons>
                </template>
            </ion-toolbar>
        </ion-header>
        <ion-content class="ion-padding">
            <div v-if="done" class="flex h-full flex-col items-center justify-center text-center">
                <div class="text-brand text-5xl">✓</div>
                <p class="mt-2 text-sm font-bold">{{ t('profile.passwordChanged') }}</p>
                <button type="button" class="app-btn app-btn-primary mt-5 w-full" @click="emit('close')">{{ t('common.close') }}</button>
            </div>

            <form v-else class="space-y-3.5" @submit.prevent="submit">
                <ion-input
                    v-model="currentPassword"
                    :label="t('profile.currentPassword')"
                    label-placement="floating"
                    type="password"
                    required
                    autocomplete="current-password"
                    class="app-input"
                />
                <ion-input
                    v-model="newPassword"
                    :label="t('profile.newPassword')"
                    label-placement="floating"
                    type="password"
                    required
                    :minlength="8"
                    autocomplete="new-password"
                    class="app-input"
                />
                <ion-input
                    v-model="confirmPassword"
                    :label="t('profile.confirmNewPassword')"
                    label-placement="floating"
                    type="password"
                    required
                    :minlength="8"
                    autocomplete="new-password"
                    class="app-input"
                />

                <p v-if="error" class="app-alert app-alert-danger">{{ error }}</p>
                <p class="text-faint text-[11px] leading-relaxed">{{ t('profile.revokeOtherHint') }}</p>

                <div class="flex justify-end gap-2 pt-1">
                    <button type="button" class="app-btn app-btn-ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
                    <button type="submit" class="app-btn app-btn-primary" :disabled="submitting">
                        {{ submitting ? t('common.loading') : t('common.confirm') }}
                    </button>
                </div>
            </form>
        </ion-content>
    </ion-modal>
</template>
