<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';
definePageMeta({ layout: 'settings' });

/**
 * 通用设置：外观（显示模式 + 品牌色）、界面语言、工作台名称。
 *
 * 两块存储口径不同，界面上刻意不再各摆一套「我的偏好 / 新访客默认」：
 * - 显示模式写 `nuxt-color-mode`（localStorage），品牌色写 `ee_theme_brand`（cookie），语言写 `app_locale`（cookie + localStorage）；
 *   这三样是即时生效的本机偏好，由 `useTheme()` 与 i18n 插件持有。
 * - 同时把同一个值 PATCH 进 `system_settings`，于是「我的偏好」就是这台机器下次冷启动的默认值
 *   （`plugins/theme-defaults.client.ts` 只在无偏好时播种，`useTheme()` 的回退也读这一份）。
 *   单用户本机应用里两者本来就该是一个东西，分成两个表单只会让人不知道改哪个。
 */
interface WorkspaceDefaults {
    siteTitle: string;
    defaultLocale: string;
    themeMode: string;
    themeBrand: string;
}

const PREF_SAVE_DEBOUNCE_MS = 500;
const LOCALES = ['zh-CN', 'en-US'] as const;
/** 自动保存的三类偏好；siteTitle 是文本框，只有点「保存」才写库，不参与这里的合并 PATCH */
const PREFERENCE_KEYS = ['themeMode', 'themeBrand', 'defaultLocale'] as const;

const { t, locale } = useI18n();
const { $setLocale } = useNuxtApp();
const { brand, mode } = useTheme();
const siteTitle = useSiteTitle();

const loading = ref(true);
const loadError = ref('');
/** 库里已保存的默认值；null 表示还没读到——读到之前不接受任何自动保存（见 schedulePreferences） */
const saved = ref<WorkspaceDefaults | null>(null);
const saveState = ref<'idle' | 'saving' | 'failed'>('idle');
/**
 * 自动保存的成功只给一条会自己消失的提示，不写进 saveState。
 *
 * 此前 'saved' 是状态机里的常驻终态：用户改完外观再回到这张卡，看到的还是「已保存为默认」，
 * 读起来像「刚才那次改动还悬着」。而失败必须留在原地等重试——两者生命周期不同，不该挤在同一个枚举里。
 */
const { success: savedHint, flashSuccess } = useFlashSuccess(2500);
/** 名称保存的提示走另一份实例：两张卡片各说各的，共用一份会让后一次文案同时出现在两行里 */
const { success: nameSavedHint, flashSuccess: flashNameSaved } = useFlashSuccess(2500);

const nameDraft = ref('');
const nameError = ref('');
const savingName = ref(false);

async function load() {
    loading.value = true;
    loadError.value = '';
    try {
        const data = await $fetch<WorkspaceDefaults>('/api/settings/system-settings');
        saved.value = data;
        nameDraft.value = data.siteTitle;
        // 改名后重启或换进程时，SSR 播种的镜像也要跟着对上，否则输入框与侧栏各说一套
        siteTitle.value = data.siteTitle;
    } catch (e) {
        saved.value = null;
        loadError.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

/* ---------------- 偏好自动保存 ---------------- */

const pending: Partial<WorkspaceDefaults> = {};
let prefTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * 并发 flush 的代人牌：一次 PATCH 还在飞时用户又改了偏好，防抖会再发一次。
 * 两个响应回来的顺序不保证，旧的那份若后到，会把 saved 覆盖成不含最新改动的行，
 * 并把「已保存」提示重新亮一遍。
 */
let flushToken = 0;

function clearPrefTimer() {
    if (prefTimer) {
        clearTimeout(prefTimer);
        prefTimer = null;
    }
}

/**
 * 记下一次要写的字段，攒成一个 PATCH。
 *
 * 与库里已存的值相同就不发请求：首屏 `theme-defaults.client.ts` 会把 colorMode 播种成
 * 系统默认（system→light 之类），这一跳不是用户改动，放任它发 PATCH 会让每次冷启动都白写一次库。
 */
function schedulePreferences(next: Partial<WorkspaceDefaults>) {
    const base = saved.value;
    if (!base) return;
    for (const key of PREFERENCE_KEYS) {
        const value = next[key];
        if (value === undefined) continue;
        if (base[key] === value) delete pending[key];
        else pending[key] = value;
    }
    if (!Object.keys(pending).length) {
        clearPrefTimer();
        return;
    }
    clearPrefTimer();
    prefTimer = setTimeout(flushPreferences, PREF_SAVE_DEBOUNCE_MS);
}

async function flushPreferences() {
    clearPrefTimer();
    const patch = { ...pending };
    if (!Object.keys(patch).length) return;
    for (const key of PREFERENCE_KEYS) delete pending[key];
    const token = ++flushToken;
    saveState.value = 'saving';
    try {
        const next = await $fetch<WorkspaceDefaults>('/api/settings/system-settings', { method: 'PATCH', body: patch });
        // 更新的一次已经回来（它拿着更新的值）：旧响应的 saved/提示都不能再覆盖
        if (token === flushToken) {
            saved.value = next;
            saveState.value = 'idle';
            flashSuccess(t('settings.preferenceSaved'));
        }
    } catch {
        if (token !== flushToken) return;
        // 失败时把字段放回 pending，重试按钮直接重放这一次；本机偏好已经生效，只是默认值没存住
        Object.assign(pending, patch);
        saveState.value = 'failed';
    }
}

function setAppLocale(next: 'zh-CN' | 'en-US') {
    $setLocale(next);
}

watch(mode, (value) => schedulePreferences({ themeMode: value }));
watch(brand, (value) => schedulePreferences({ themeBrand: value }));
watch(locale, (value) => schedulePreferences({ defaultLocale: value }));

/**
 * 离开本页时把还压在防抖窗口里的改动发出去。
 *
 * 只清定时器会把这次改动丢掉：本机偏好（cookie/localStorage）已经生效，但「下次冷启动的默认值」
 * 还是旧的——用户改完语言立刻切走，重启后又变回去，而且界面不会有任何提示。
 */
onBeforeUnmount(() => {
    if (!prefTimer) return;
    clearPrefTimer();
    void flushPreferences();
});

/* ---------------- 工作台名称 ---------------- */

async function saveName() {
    if (savingName.value) return;
    const title = nameDraft.value.trim();
    if (!title) {
        nameError.value = t('common.required', { field: t('settings.workspaceTitle') });
        return;
    }
    nameError.value = '';
    if (title === saved.value?.siteTitle) {
        // 点了保存但文字没动过：给一句「已保存」而不是静默返回，否则用户以为按钮坏了
        flashNameSaved(t('settings.nameSaved'));
        return;
    }
    savingName.value = true;
    try {
        const next = await $fetch<WorkspaceDefaults>('/api/settings/system-settings', { method: 'PATCH', body: { siteTitle: title } });
        saved.value = next;
        nameDraft.value = next.siteTitle;
        // 侧栏品牌与浏览器标题读的是这个镜像，不写就要等下一次 SSR 才看得到新名字
        siteTitle.value = next.siteTitle;
        flashNameSaved(t('settings.nameSaved'));
    } catch (e) {
        nameError.value = extractApiError(e, t('common.error'));
    } finally {
        savingName.value = false;
    }
}

const saveStateLabel = computed(() => (saveState.value === 'saving' ? t('settings.preferenceSaving') : t('settings.preferenceFailed')));

interface HealthCheck {
    status: 'up' | 'down' | 'degraded' | 'not_configured';
}
interface HealthResponse {
    status: 'healthy' | 'degraded' | 'unhealthy';
    ready: boolean;
    timestamp: string;
    totalLatencyMs: number;
    checks: {
        database: HealthCheck;
        redis: HealthCheck;
        modelProvider: HealthCheck;
    };
}

const health = ref<HealthResponse | null>(null);
const healthLoading = ref(false);
const healthError = ref('');

async function loadHealth() {
    if (healthLoading.value) return;
    healthLoading.value = true;
    healthError.value = '';
    try {
        health.value = await $fetch<HealthResponse>('/api/health');
    } catch (e) {
        health.value = null;
        healthError.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        healthLoading.value = false;
    }
}

onMounted(() => {
    void loadHealth();
});

const healthItems = computed(() => {
    if (!health.value) return [];
    return [
        { key: 'database', label: t('settings.healthDatabase'), status: health.value.checks.database.status },
        { key: 'redis', label: t('settings.healthRedis'), status: health.value.checks.redis.status },
        { key: 'model', label: t('settings.healthModel'), status: health.value.checks.modelProvider.status },
    ];
});

function healthTone(status: string) {
    if (status === 'up' || status === 'healthy') return 'app-badge-success';
    if (status === 'down' || status === 'unhealthy') return 'app-badge-danger';
    if (status === 'degraded') return 'app-badge-warning';
    return 'app-badge-neutral';
}

function healthLabel(status: string) {
    if (status === 'up' || status === 'healthy') return t('settings.healthUp');
    if (status === 'down' || status === 'unhealthy') return t('settings.healthDown');
    if (status === 'degraded') return t('settings.healthDegraded');
    return t('settings.healthNotConfigured');
}
</script>

<template>
    <div class="space-y-5">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ t('settings.navGeneral') }}</h1>
                <p class="app-page-subtitle">{{ t('settings.generalSubtitle') }}</p>
            </div>
        </div>

        <div v-if="loadError" class="app-alert app-alert-danger">
            {{ loadError }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>

        <p class="text-faint text-xs">{{ t('settings.basicHint') }}</p>

        <section class="app-card space-y-4 p-4 sm:p-5">
            <div v-if="loading" class="app-skeleton h-40 !rounded-xl" />
            <template v-else>
                <ThemeSwitcher variant="panel" />

                <div class="border-line border-t pt-4">
                    <p class="app-dropdown-label !px-0">{{ t('settings.languageTitle') }}</p>
                    <div class="app-segmented w-full" role="group" :aria-label="t('settings.languageTitle')">
                        <button
                            v-for="item in LOCALES"
                            :key="item"
                            type="button"
                            class="app-segmented-item flex-1"
                            :aria-pressed="locale === item"
                            @click="setAppLocale(item)"
                        >
                            <span>{{ item === 'zh-CN' ? '简体中文' : 'English' }}</span>
                        </button>
                    </div>
                </div>

                <div v-if="!loading && !saved" class="border-line border-t pt-3">
                    <!-- 读取失败时 saved=null，schedulePreferences 会静默丢弃每一笔改动：
                         本机偏好照常生效，但「下次启动的默认值」并不会变，不说明就会被当成已保存 -->
                    <p class="text-faint text-[11px]">{{ t('settings.preferencesOffline') }}</p>
                </div>

                <div v-if="saveState !== 'idle' || savedHint" class="border-line flex items-center gap-2 border-t pt-3">
                    <span
                        class="text-faint flex items-center gap-1.5 text-[11px]"
                        :class="saveState === 'failed' ? '!text-[color:var(--danger)]' : ''"
                        :aria-live="saveState === 'failed' ? 'assertive' : 'polite'"
                    >
                        <AppIcon
                            :name="saveState === 'failed' ? 'alert-circle-outline' : saveState === 'saving' ? 'autorenew' : 'check-circle-outline'"
                            :size="13"
                            :class="saveState === 'saving' ? 'animate-spin' : ''"
                        />
                        {{ saveState === 'idle' ? savedHint : saveStateLabel }}
                    </span>
                    <button v-if="saveState === 'failed'" type="button" class="app-btn app-btn-ghost !px-2 !py-0.5 !text-[11px]" @click="flushPreferences">
                        {{ t('common.retry') }}
                    </button>
                </div>
            </template>
        </section>

        <section class="app-card space-y-3 p-4 sm:p-5">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h2 class="text-sm font-black"><AppIcon name="history" :size="15" class="mr-1 inline" />{{ t('settings.healthTitle') }}</h2>
                    <p class="text-faint mt-1 text-[11px]">{{ t('settings.healthSubtitle') }}</p>
                </div>
                <button type="button" class="app-btn app-btn-ghost !px-3 !py-1.5 !text-xs" :disabled="healthLoading" @click="loadHealth">
                    <AppIcon name="autorenew" :size="14" :class="healthLoading ? 'animate-spin' : ''" />
                    <span>{{ healthLoading ? t('common.loading') : t('common.retry') }}</span>
                </button>
            </div>
            <div v-if="healthError" class="app-alert app-alert-danger !text-xs">{{ healthError }}</div>
            <div v-else-if="health" class="grid gap-2 sm:grid-cols-4">
                <div class="rounded-xl border border-[color:var(--line)] p-3">
                    <p class="text-faint text-[10px]">{{ t('settings.healthOverall') }}</p>
                    <span class="app-badge mt-1 inline-flex" :class="healthTone(health.status)">{{ healthLabel(health.status) }}</span>
                </div>
                <div v-for="item in healthItems" :key="item.key" class="rounded-xl border border-[color:var(--line)] p-3">
                    <p class="text-faint text-[10px]">{{ item.label }}</p>
                    <span class="app-badge mt-1 inline-flex" :class="healthTone(item.status)">{{ healthLabel(item.status) }}</span>
                </div>
            </div>
        </section>

        <section class="app-card space-y-2 p-4 sm:p-5">
            <h2 class="text-sm font-black"><AppIcon name="cog-outline" :size="15" class="mr-1 inline" />{{ t('settings.workspaceTitle') }}</h2>
            <form class="flex flex-wrap items-center gap-2" @submit.prevent="saveName">
                <input
                    v-model="nameDraft"
                    type="text"
                    maxlength="60"
                    class="app-input min-w-0 flex-1 !text-sm"
                    :placeholder="t('settings.workspacePlaceholder')"
                    :aria-label="t('settings.workspaceTitle')"
                />
                <button type="submit" class="app-btn app-btn-primary" :disabled="savingName || !nameDraft.trim()">
                    {{ savingName ? t('common.loading') : t('common.save') }}
                </button>
            </form>
            <p v-if="nameError" class="text-xs text-[color:var(--danger)]">{{ nameError }}</p>
            <p v-else class="text-faint text-[11px]">{{ t('settings.workspaceHint') }}</p>
            <p v-if="nameSavedHint" class="text-faint flex items-center gap-1.5 text-[11px]" aria-live="polite">
                <AppIcon name="check-circle-outline" :size="13" />
                <span>{{ nameSavedHint }}</span>
            </p>
        </section>
    </div>
</template>
