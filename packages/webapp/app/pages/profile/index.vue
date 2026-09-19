<script setup lang="ts">
import { formatDate, quotaUsedPercent, type MeResponse } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ middleware: 'auth' });

const { t } = useI18n();
const props = defineProps<{ me: MeResponse | null }>();

const membership = computed(() => props.me?.membership ?? null);
const stats = computed(() => props.me?.stats);
const quotaPercent = computed(() => quotaUsedPercent(membership.value?.usedToday, membership.value?.chatQuotaPerDay));
</script>

<template>
    <div class="space-y-6">
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div class="app-card p-5">
                <div class="text-faint flex items-center justify-between text-xs font-medium">
                    <span>{{ t('nav.conversations') }}</span>
                    <span class="text-base">💬</span>
                </div>
                <div class="mt-2 text-2xl font-black">{{ stats?.totalConversations ?? 0 }}</div>
            </div>
            <div class="app-card p-5">
                <div class="text-faint flex items-center justify-between text-xs font-medium">
                    <span>{{ t('billing.usedToday') }}</span>
                    <span class="text-base">⚡</span>
                </div>
                <div class="mt-2 text-2xl font-black">{{ membership?.usedToday ?? 0 }}</div>
            </div>
            <div class="app-card p-5">
                <div class="text-faint flex items-center justify-between text-xs font-medium">
                    <span>{{ t('profile.memberLevel') }}</span>
                    <span class="text-base">👑</span>
                </div>
                <div class="mt-2 truncate text-base font-black">{{ membership?.plan?.name || t('billing.freePlan') }}</div>
            </div>
            <div class="app-card p-5">
                <div class="text-faint flex items-center justify-between text-xs font-medium">
                    <span>System Probe</span>
                    <span class="text-base">🩺</span>
                </div>
                <a href="/api/health" target="_blank" class="app-link mt-2 inline-flex items-center gap-1 text-xs">/api/health ›</a>
            </div>
        </div>

        <!-- 额度卡片 -->
        <div class="app-card p-6">
            <div>
                <h2 class="text-base font-black">{{ t('profile.quotaUsage') }}</h2>
                <p class="text-faint mt-0.5 text-xs">{{ t('billing.subtitle') }}</p>

                <div class="app-panel mt-5 p-4">
                    <div class="text-soft flex items-center justify-between text-xs font-semibold">
                        <span>{{ t('billing.usedToday') }}</span>
                        <span>
                            {{ membership?.usedToday ?? 0 }} /
                            {{ membership?.chatQuotaPerDay === null ? t('billing.unlimited') : `${membership?.chatQuotaPerDay ?? 0}` }}
                        </span>
                    </div>
                    <div class="app-progress mt-2.5">
                        <div
                            class="h-full rounded-full transition-all duration-500"
                            :style="{
                                width: `${quotaPercent}%`,
                                backgroundColor: quotaPercent >= 90 ? 'var(--danger)' : quotaPercent >= 70 ? 'var(--warning)' : 'var(--brand)',
                            }"
                        />
                    </div>
                </div>
            </div>

            <div class="app-divider mt-6 flex items-center justify-between pt-4 text-xs">
                <span class="text-faint">{{ t('billing.expiresAt') }}:</span>
                <span class="font-bold">
                    {{ membership?.expiresAt ? formatDate(membership.expiresAt) : t('billing.unlimited') }}
                </span>
            </div>
        </div>
    </div>
</template>
