<script setup lang="ts">
import { extractApiError, formatDate, formatYuan, orderStatusLabelKey, orderStatusTone, type MeResponse, type OrdersResponse } from '@commons/contract';
import { IonActionSheet, IonContent, IonHeader, IonRefresher, IonRefresherContent, IonTitle, IonToolbar } from '@ionic/vue';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { api, fetchSession, signOut, type SessionPayload } from '../api/auth';
import ThemeSettings from '../components/ThemeSettings.vue';
import { useDialog } from '../composables/useDialog';
import { useUnread } from '../composables/useUnread';
import { setMobileLocale } from '../i18n';
import PageShell from './PageShell.vue';

const { t, locale } = useI18n();
const router = useRouter();
const { confirmDialog } = useDialog();

const session = ref<SessionPayload | null>(null);
const me = ref<MeResponse | null>(null);
const orders = ref<OrdersResponse['orders']>([]);
const showLanguageSheet = ref(false);
const loading = ref(false);
const error = ref('');

const membership = computed(() => me.value?.membership ?? null);
const stats = computed(() => me.value?.stats);
const recentOrders = computed(() => orders.value.slice(0, 3));
// 未读数来自共享 composable：在消息页标记已读后，返回本页角标自动同步
const { unread: unreadCount, refresh: refreshUnread, resetUnread } = useUnread();

const languageActions = [
    { text: '简体中文 (zh-CN)', handler: () => setMobileLocale('zh-CN') },
    { text: 'English (en-US)', handler: () => setMobileLocale('en-US') },
    { text: '取消 / Cancel', role: 'cancel' },
];

async function loadData() {
    loading.value = true;
    error.value = '';
    try {
        session.value = await fetchSession();
        const [meRes, orderRes] = await Promise.all([api<MeResponse>('/api/me'), api<OrdersResponse>('/api/billing/orders')]);
        me.value = meRes;
        orders.value = orderRes.orders;
        // 未读角标为辅助信息，失败不影响个人中心其余内容
        void refreshUnread(true);
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    } finally {
        loading.value = false;
    }
}

async function handleRefresh(event: CustomEvent) {
    await loadData();
    (event.target as HTMLIonRefresherElement).complete();
}

onMounted(loadData);

async function logout() {
    if (!(await confirmDialog(t('profile.logoutConfirm')))) return;
    await signOut();
    // 清空共享未读状态，避免下一个登录账号看到上一个账号的角标
    resetUnread();
    router.replace('/login');
}
</script>

<template>
    <PageShell>
        <ion-header class="ion-no-border">
            <ion-toolbar>
                <ion-title class="!text-lg font-black">{{ t('nav.me') }}</ion-title>
            </ion-toolbar>
        </ion-header>

        <ion-content>
            <template v-slot:fixed>
                <ion-refresher @ion-refresh="handleRefresh">
                    <ion-refresher-content pulling-text="下拉刷新" refreshing-spinner="crescent" />
                </ion-refresher>
            </template>

            <div v-if="session" class="space-y-4 p-4">
                <div v-if="error" class="app-alert app-alert-danger">{{ error }}</div>

                <!-- 用户信息 -->
                <div class="app-card flex items-center gap-4 p-5">
                    <div class="app-avatar h-14 w-14 !rounded-2xl text-xl">
                        {{ session.user.name?.[0]?.toUpperCase() || 'U' }}
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <h2 class="truncate text-base font-black">{{ session.user.name }}</h2>
                            <span v-if="session.user.role === 'admin'" class="app-badge app-badge-danger uppercase">Admin</span>
                        </div>
                        <p class="text-faint mt-1 truncate text-[11px]">{{ session.user.email }}</p>
                    </div>
                </div>

                <!-- 会员卡片 -->
                <div class="app-card p-5">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-faint text-[11px]">{{ t('profile.memberLevel') }}</p>
                            <h3 class="mt-0.5 text-base font-black">{{ membership?.plan?.name || t('billing.freePlan') }}</h3>
                        </div>
                        <router-link to="/membership" class="app-btn app-btn-soft">{{ t('billing.upgrade') }}</router-link>
                    </div>

                    <div class="mt-4 space-y-2 border-t pt-3 text-[11px]" style="border-color: var(--line)">
                        <div class="flex justify-between">
                            <span class="text-muted-2">{{ t('billing.usedToday') }}</span>
                            <span class="font-bold">
                                {{
                                    membership?.chatQuotaPerDay === null || membership?.chatQuotaPerDay === undefined
                                        ? t('billing.unlimited')
                                        : `${membership.usedToday} / ${membership.chatQuotaPerDay}`
                                }}
                            </span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-2">{{ t('nav.conversations') }}</span>
                            <span class="font-bold">{{ stats?.totalConversations ?? 0 }}</span>
                        </div>
                        <div v-if="membership?.expiresAt" class="flex justify-between">
                            <span class="text-muted-2">{{ t('billing.expiresAt') }}</span>
                            <span class="font-bold">{{ formatDate(membership.expiresAt) }}</span>
                        </div>
                    </div>
                </div>

                <!-- 功能入口 -->
                <div class="app-card divide-y divide-[color:var(--line)] p-0">
                    <router-link to="/news" class="flex items-center gap-3 p-3.5 transition-colors active:bg-[color:var(--surface-3)]">
                        <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-[color:var(--surface-3)] text-base">📰</span>
                        <span class="flex-1 text-xs font-bold">{{ t('nav.news') }}</span>
                        <span class="text-faint text-xs">›</span>
                    </router-link>
                    <router-link to="/notifications" class="flex items-center gap-3 p-3.5 transition-colors active:bg-[color:var(--surface-3)]">
                        <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-[color:var(--surface-3)] text-base">🔔</span>
                        <span class="flex-1 text-xs font-bold">{{ t('nav.notifications') }}</span>
                        <span v-if="unreadCount" class="app-badge app-badge-danger !text-[10px]">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
                        <span class="text-faint text-xs">›</span>
                    </router-link>
                    <router-link to="/attachments" class="flex items-center gap-3 p-3.5 transition-colors active:bg-[color:var(--surface-3)]">
                        <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-[color:var(--surface-3)] text-base">📎</span>
                        <span class="flex-1 text-xs font-bold">{{ t('nav.attachments') }}</span>
                        <span class="text-faint text-xs">›</span>
                    </router-link>
                </div>

                <!-- 主题设置 -->
                <div>
                    <p class="text-faint mb-2 px-1 text-[11px] font-bold">{{ t('profile.preferences') }}</p>
                    <ThemeSettings />
                </div>

                <!-- 语言 -->
                <div class="app-panel flex items-center justify-between p-3.5">
                    <div>
                        <p class="text-xs font-bold">{{ t('profile.languageSelect') }}</p>
                        <p class="text-faint mt-0.5 text-[11px]">{{ locale === 'zh-CN' ? '简体中文' : 'English' }}</p>
                    </div>
                    <button type="button" class="app-btn app-btn-outline" @click="showLanguageSheet = true">🌐 {{ t('common.change') }}</button>
                </div>

                <!-- 最近订单 -->
                <div v-if="recentOrders.length" class="app-card p-4">
                    <h3 class="text-sm font-black">{{ t('nav.orders') }}</h3>
                    <ul class="mt-3 space-y-3">
                        <li v-for="o in recentOrders" :key="o.id" class="flex items-center justify-between text-xs">
                            <div class="min-w-0">
                                <p class="truncate font-semibold">{{ o.planCode }}</p>
                                <p class="text-faint mt-0.5 font-mono text-[10px]">{{ o.orderNo }}</p>
                            </div>
                            <div class="text-right">
                                <p class="font-black">¥{{ formatYuan(o.amountCents) }}</p>
                                <span :class="['app-badge mt-1', orderStatusTone(o.status)]">{{ t(orderStatusLabelKey(o.status)) }}</span>
                            </div>
                        </li>
                    </ul>
                </div>

                <button class="app-btn app-btn-danger w-full !py-3" @click="logout">{{ t('nav.logout') }}</button>
                <p class="text-faint pb-4 text-center text-[10px]">EE Agent Platform · v26.4.0</p>
            </div>

            <div v-else class="flex h-full flex-col items-center justify-center p-8 text-center">
                <template v-if="loading">
                    <div class="app-skeleton h-14 w-14 !rounded-2xl" />
                    <div class="app-skeleton mt-3 h-4 w-32" />
                    <p class="text-faint mt-4 text-xs">{{ t('common.loading') }}</p>
                </template>
                <!-- 会话拉取失败时空白骨架会被读成「还在加载」，这里显式报错并给重试入口 -->
                <template v-else>
                    <p class="text-3xl">⚠️</p>
                    <p class="text-faint mt-3 text-xs">{{ error || t('common.error') }}</p>
                    <button type="button" class="app-btn app-btn-outline mt-4 !px-4 !py-1.5 text-xs" @click="loadData">{{ t('common.retry') }}</button>
                </template>
            </div>
        </ion-content>

        <ion-action-sheet
            :is-open="showLanguageSheet"
            :header="t('profile.languageSelect')"
            :buttons="languageActions"
            @did-dismiss="showLanguageSheet = false"
        />
    </PageShell>
</template>
