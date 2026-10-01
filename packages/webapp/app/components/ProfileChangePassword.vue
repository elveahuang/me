<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import { authClient } from '../utils/auth-client';

/**
 * 修改密码（个人中心）：自含触发按钮与弹窗表单。
 *
 * 走 Better Auth 内置的 /api/auth/change-password（需要当前密码，无需服务端新代码）。
 * revokeOtherSessions 固定为 true：改密码的常见动机是凭据疑似泄露，其他设备的旧会话
 * 一并作废；当前会话由服务端在响应里换发 cookie，不受影响。
 */
const { t } = useI18n();

const PASSWORD_MIN_LENGTH = 8;

const open = ref(false);
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const submitting = ref(false);
const error = ref('');
/** 成功态在弹窗内呈现：关闭弹窗后提示会随组件卸载丢失，弹窗里给出明确的完成反馈 */
const done = ref(false);

function openModal() {
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    error.value = '';
    done.value = false;
    open.value = true;
}

function closeModal() {
    open.value = false;
}

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
    <button type="button" class="app-btn app-btn-outline" @click="openModal">{{ t('profile.changePassword') }}</button>

    <Teleport to="body">
        <div v-if="open" class="app-modal-backdrop" role="dialog" aria-modal="true" :aria-label="t('profile.changePassword')" @click.self="closeModal">
            <!-- 用 .app-modal 而不是裸 app-card：移动端媒体查询会把它转成底部抽屉 -->
            <div class="app-modal">
                <div class="app-modal-header">
                    <h3 class="text-sm font-black">{{ t('profile.changePassword') }}</h3>
                    <button type="button" class="text-faint text-hover-strong -m-1.5 p-1.5" :aria-label="t('common.close')" @click="closeModal">✕</button>
                </div>

                <div v-if="done" class="app-modal-body">
                    <div class="py-4 text-center">
                        <div class="text-brand text-4xl">✓</div>
                        <p class="mt-2 text-sm font-bold">{{ t('profile.passwordChanged') }}</p>
                        <button type="button" class="app-btn app-btn-primary mt-5 w-full" @click="closeModal">{{ t('common.close') }}</button>
                    </div>
                </div>

                <form v-else class="app-modal-body space-y-3" @submit.prevent="submit">
                    <div>
                        <label class="app-label" for="change-password-current">{{ t('profile.currentPassword') }}</label>
                        <input
                            id="change-password-current"
                            v-model="currentPassword"
                            type="password"
                            required
                            autocomplete="current-password"
                            class="app-input"
                        />
                    </div>
                    <div>
                        <label class="app-label" for="change-password-new">{{ t('profile.newPassword') }}</label>
                        <input
                            id="change-password-new"
                            v-model="newPassword"
                            type="password"
                            required
                            minlength="8"
                            autocomplete="new-password"
                            class="app-input"
                        />
                    </div>
                    <div>
                        <label class="app-label" for="change-password-confirm">{{ t('profile.confirmNewPassword') }}</label>
                        <input
                            id="change-password-confirm"
                            v-model="confirmPassword"
                            type="password"
                            required
                            minlength="8"
                            autocomplete="new-password"
                            class="app-input"
                        />
                    </div>

                    <p v-if="error" class="app-help app-help-error">{{ error }}</p>
                    <p class="app-help">{{ t('profile.revokeOtherHint') }}</p>

                    <div class="flex justify-end gap-2 pt-1">
                        <button type="button" class="app-btn app-btn-ghost" @click="closeModal">{{ t('common.cancel') }}</button>
                        <button type="submit" class="app-btn app-btn-primary" :disabled="submitting">
                            {{ submitting ? t('common.loading') : t('common.save') }}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </Teleport>
</template>
