/**
 * Web / Mobile 共用契约层（webapp 与 mobile 通过构建别名 `@commons/contract` 引用）。
 *
 * 目标：两端的接口类型、错误提示、金额/日期格式化、主题状态机只有一个事实来源，
 * 避免再次出现「移动端按 A 结构解析、服务端返回 B 结构」而整页崩溃的问题。
 */

// ============================================================
// 会话与用户
// ============================================================

export type UserRole = 'admin' | 'editor' | 'user';

export interface SessionUser {
    id: string;
    name: string;
    email: string;
    emailVerified?: boolean;
    image?: string | null;
    role: UserRole | string;
    banned?: boolean | null;
}

export interface MeResponse {
    user: SessionUser;
    stats: {
        totalConversations: number;
    };
    membership: MembershipStatus;
}

// ============================================================
// 智能体
// ============================================================

export interface AgentSkillRef {
    id: string;
    name: string;
    description?: string;
}

export interface AgentToolRef {
    id: string;
    name: string;
    type: string;
    description?: string;
}

/** GET /api/agents 列表项 */
export interface AgentSummary {
    id: string;
    name: string;
    emoji: string | null;
    avatar: string | null;
    description: string;
    skills: AgentSkillRef[];
}

/** GET /api/agents/:id */
export interface AgentDetail extends AgentSummary {
    model: string;
    providerId: string | null;
    temperature: number | null;
    maxTokens: number | null;
    maxSteps: number;
    selfConfig: boolean;
    tools: AgentToolRef[];
    knowledgeBases?: { id: string; name: string }[];
    mcpServers?: { id: string; name: string }[];
}

// ============================================================
// 会话与消息
// ============================================================

export interface ConversationSummary {
    id: string;
    title: string;
    agentId: string;
    agentName: string;
    updatedAt: string;
}

export interface ChatTextPart {
    type: 'text';
    text: string;
}

export interface ChatReasoningPart {
    type: 'reasoning';
    text?: string;
    reasoning?: string;
}

export interface ChatToolPart {
    type: string;
    toolName?: string;
    input?: unknown;
    output?: unknown;
    state?: string;
}

export type ChatPart = ChatTextPart | ChatReasoningPart | ChatToolPart | Record<string, unknown>;

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    parts: ChatPart[];
}

export interface ConversationDetail {
    conversation: ConversationSummary & { userId: string; agentId: string };
    messages: ChatMessage[];
}

// ============================================================
// 会员 / 计费
// ============================================================

export type BillingPeriod = 'monthly' | 'yearly';
export type OrderStatus = 'pending' | 'paid' | 'closed' | 'refunded';

export interface Plan {
    id: string;
    code: string;
    name: string;
    description: string;
    chatQuotaPerDay: number | null;
    monthlyPriceCents: number;
    yearlyPriceCents: number | null;
    enabled: boolean;
    sortOrder: number;
}

export interface PaymentProviderInfo {
    code: string;
    available: boolean;
}

export interface PlansResponse {
    plans: Plan[];
    providers: PaymentProviderInfo[];
}

export interface MembershipStatus {
    /** 当前生效套餐（无付费会员时为 free 档或 null） */
    plan: Plan | null;
    expiresAt: string | null;
    /** 每日配额，null 表示不限量 */
    chatQuotaPerDay: number | null;
    usedToday: number;
}

export type PaymentMode = 'qrcode' | 'jsapi' | 'redirect' | 'mock';

export interface JsapiParams {
    appId: string;
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: string;
    paySign: string;
}

/** POST /api/billing/orders 的响应 */
export interface CreateOrderResponse {
    orderNo: string;
    status: OrderStatus;
    provider: string;
    mode: PaymentMode;
    payUrl?: string;
    jsapiParams?: JsapiParams;
    amountCents: number;
    planCode: string;
    period: BillingPeriod;
}

/** GET /api/billing/orders/:orderNo 的响应（轮询用） */
export interface OrderStatusResponse {
    orderNo: string;
    status: OrderStatus;
    provider: string;
    planCode: string;
    period: BillingPeriod;
    amountCents: number;
    mode: PaymentMode | null;
    payUrl: string | null;
    jsapiParams: JsapiParams | null;
    paidAt: string | null;
    createdAt: string;
}

export interface OrderRecord {
    id: string;
    orderNo: string;
    planId?: string;
    planCode: string;
    period: BillingPeriod;
    amountCents: number;
    status: OrderStatus;
    provider: string;
    providerTradeNo?: string | null;
    payInfo?: Record<string, unknown> | null;
    paidAt: string | null;
    closedAt?: string | null;
    createdAt: string;
    updatedAt?: string;
}

export interface OrdersResponse {
    orders: OrderRecord[];
}

export interface CreateOrderRequest {
    planId: string;
    period: BillingPeriod;
    provider?: string;
}

// ============================================================
// 附件管理（对象存储，S3 协议）
// ============================================================

export type AttachmentCategory = 'chat' | 'image' | 'document' | 'avatar' | 'other';

export const ATTACHMENT_CATEGORIES: { value: AttachmentCategory; label: string; labelEn: string }[] = [
    { value: 'chat', label: '会话附件', labelEn: 'Chat' },
    { value: 'image', label: '图片素材', labelEn: 'Image' },
    { value: 'document', label: '业务文档', labelEn: 'Document' },
    { value: 'avatar', label: '头像', labelEn: 'Avatar' },
    { value: 'other', label: '其他文件', labelEn: 'Other' },
];

export interface AttachmentRecord {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    category: AttachmentCategory | string;
    createdAt: string;
    /** 可直接访问的地址（公开桶为公共 URL，私有桶为限时预签名 URL） */
    url: string | null;
    /** 资源是否是图片，便于列表直接决定是否显示缩略图 */
    isImage: boolean;
}

export interface AttachmentsResponse {
    attachments: AttachmentRecord[];
    total: number;
}

export const ATTACHMENT_MAX_SIZE_MB = 20;

/** 上传前的本地校验：返回错误文案，通过返回 null（两端共用同一套规则） */
export function validateAttachmentFile(file: { name: string; size: number; type: string }, maxSizeMb = ATTACHMENT_MAX_SIZE_MB): string | null {
    if (!file.name) return '文件名不能为空';
    if (file.size <= 0) return '文件内容为空';
    if (file.size > maxSizeMb * 1024 * 1024) return `文件超过 ${maxSizeMb}MB 限制`;
    return null;
}

/** 字节数转可读体积（1.5 KB / 2.3 MB） */
export function formatBytes(size: number | null | undefined): string {
    const value = Math.max(0, Number(size) || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ============================================================
// 资讯新闻
// ============================================================

export type NewsStatus = 'draft' | 'published';

export interface NewsSummary {
    id: string;
    title: string;
    summary: string;
    coverImage: string;
    category: string;
    tags: string[];
    pinned: boolean;
    viewCount: number;
    publishedAt: string | null;
    createdAt: string;
}

export interface NewsArticle extends NewsSummary {
    content: string;
}

export interface NewsListResponse {
    items: NewsSummary[];
    total: number;
    page: number;
    pageSize: number;
}

// ============================================================
// 宣传栏（运营位 / 公告横幅）
// ============================================================

export type BulletinPosition = 'home' | 'chat' | 'global';
export type BulletinLevel = 'info' | 'success' | 'warning' | 'danger';

export const BULLETIN_POSITIONS: { value: BulletinPosition; label: string; labelEn: string }[] = [
    { value: 'home', label: '首页', labelEn: 'Home' },
    { value: 'chat', label: '对话页', labelEn: 'Chat' },
    { value: 'global', label: '全站', labelEn: 'Global' },
];

export const BULLETIN_LEVELS: { value: BulletinLevel; label: string; labelEn: string }[] = [
    { value: 'info', label: '信息', labelEn: 'Info' },
    { value: 'success', label: '推荐', labelEn: 'Success' },
    { value: 'warning', label: '提醒', labelEn: 'Warning' },
    { value: 'danger', label: '重要', labelEn: 'Important' },
];

export interface BulletinRecord {
    id: string;
    title: string;
    content: string;
    imageUrl: string;
    linkUrl: string;
    linkText: string;
    position: BulletinPosition | string;
    level: BulletinLevel | string;
    enabled: boolean;
    sortOrder: number;
    startsAt: string | null;
    endsAt: string | null;
    createdAt: string;
}

export interface BulletinsResponse {
    bulletins: BulletinRecord[];
}

/** 判断宣传栏当前是否在投放时间窗内（两端与管理端共用） */
export function isBulletinActive(bulletin: Pick<BulletinRecord, 'enabled' | 'startsAt' | 'endsAt'>, now = Date.now()): boolean {
    if (!bulletin.enabled) return false;
    if (bulletin.startsAt && new Date(bulletin.startsAt).getTime() > now) return false;
    if (bulletin.endsAt && new Date(bulletin.endsAt).getTime() < now) return false;
    return true;
}

// ============================================================
// 消息通知
// ============================================================

export type NotificationType = 'system' | 'announcement' | 'activity' | 'billing';
export type NotificationAudience = 'all' | 'users';

export const NOTIFICATION_TYPES: { value: NotificationType; label: string; labelEn: string }[] = [
    { value: 'system', label: '系统消息', labelEn: 'System' },
    { value: 'announcement', label: '平台公告', labelEn: 'Announcement' },
    { value: 'activity', label: '活动通知', labelEn: 'Activity' },
    { value: 'billing', label: '账单提醒', labelEn: 'Billing' },
];

export interface NotificationRecord {
    id: string;
    title: string;
    content: string;
    type: NotificationType | string;
    level: BulletinLevel | string;
    audience: NotificationAudience | string;
    linkUrl: string;
    createdAt: string;
    readAt: string | null;
    read: boolean;
}

export interface NotificationsResponse {
    items: NotificationRecord[];
    total: number;
    unread: number;
    page: number;
    pageSize: number;
}

/** 相对时间文案（分钟/小时/天），超过 7 天回退日期 */
export function formatRelativeTime(iso: string | null | undefined, locale = 'zh-CN'): string {
    if (!iso) return '-';
    const time = new Date(iso).getTime();
    if (Number.isNaN(time)) return '-';
    const diff = Date.now() - time;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return locale === 'zh-CN' ? '刚刚' : 'Just now';
    if (diff < hour) return locale === 'zh-CN' ? `${Math.floor(diff / minute)} 分钟前` : `${Math.floor(diff / minute)} min ago`;
    if (diff < day) return locale === 'zh-CN' ? `${Math.floor(diff / hour)} 小时前` : `${Math.floor(diff / hour)} h ago`;
    if (diff < 7 * day) return locale === 'zh-CN' ? `${Math.floor(diff / day)} 天前` : `${Math.floor(diff / day)} d ago`;
    return formatDate(iso, locale);
}

// ============================================================
// 错误与展示辅助
// ============================================================

/** 从 $fetch / fetch / Error 中提取可展示的错误文案 */
export function extractApiError(error: unknown, fallback = '操作失败，请稍后重试'): string {
    if (!error) return fallback;
    const err = error as {
        data?: { statusMessage?: string; message?: string };
        statusMessage?: string;
        message?: string;
        status?: number;
        statusCode?: number;
    };
    const fromData = err.data?.statusMessage || err.data?.message;
    if (fromData) return fromData;
    if (err.statusMessage) return err.statusMessage;
    const status = err.status ?? err.statusCode;
    const message = typeof err.message === 'string' ? err.message.trim() : '';
    /**
     * 部分 SDK（如 AI SDK 的 Chat）会把整个 JSON 响应体塞进 message，
     * 直接返回会把服务端字段甚至堆栈暴露给用户，这里再解析一层。
     */
    const fromJson = readJsonMessage(message);
    if (fromJson) return fromJson;
    if (message && fromJson === undefined && !/^\d{3}$/.test(message)) {
        return status && !message.includes(String(status)) ? `${message}（${status}）` : message;
    }
    if (status === 401) return '登录状态已失效，请重新登录';
    if (status === 402) return '今日额度已用完，升级会员可获得更多额度';
    if (status === 429) return '操作过于频繁，请稍后再试';
    return status ? `${fallback}（${status}）` : fallback;
}

/**
 * 读取「整个 JSON 响应体被塞进 message」的错误文案。
 * 返回 undefined 表示不是 JSON；返回空串表示是 JSON 但没有可读文案。
 */
function readJsonMessage(message: string): string | undefined {
    if (!message.startsWith('{') || !message.endsWith('}')) return undefined;
    try {
        const payload = JSON.parse(message) as { statusMessage?: unknown; message?: unknown };
        const value = payload.statusMessage ?? payload.message;
        return typeof value === 'string' ? value.trim() : '';
    } catch {
        return undefined;
    }
}

/** 判断错误是否为「配额用尽」（402） */
export function isQuotaError(error: unknown): boolean {
    const err = error as { status?: number; statusCode?: number; data?: { statusCode?: number }; message?: string } | null;
    if (!err) return false;
    const status = err.status ?? err.statusCode ?? err.data?.statusCode;
    if (status === 402) return true;
    const text = String(err.message ?? '');
    return text.includes('402') || text.includes('配额') || text.includes('额度');
}

/** 分转元，保留 2 位；null/undefined 视为 0 */
export function formatYuan(cents: number | null | undefined): string {
    if (cents === null || cents === undefined || Number.isNaN(cents)) return '0.00';
    return (cents / 100).toFixed(2);
}

/** 日期展示（两端一致） */
export function formatDate(iso: string | null | undefined, locale = 'zh-CN'): string {
    if (!iso) return '-';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString(locale);
}

/** 配额使用率（0-100），不限量返回 0 */
export function quotaUsedPercent(used: number | null | undefined, quota: number | null | undefined): number {
    if (!quota || quota <= 0) return 0;
    const safeUsed = Math.max(0, used ?? 0);
    return Math.min(100, Math.round((safeUsed / quota) * 100));
}

/** 剩余额度文案 */
export function quotaText(used: number | null | undefined, quota: number | null | undefined, unlimitedText = '不限量'): string {
    if (quota === null || quota === undefined) return unlimitedText;
    return `${Math.max(0, used ?? 0)} / ${quota}`;
}

/** 会员档位对应的展示色调（用于徽标） */
export function planTone(code: string | null | undefined): 'neutral' | 'brand' | 'accent' | 'warning' {
    switch (code) {
        case 'pro':
            return 'brand';
        case 'max':
            return 'accent';
        case 'free':
        default:
            return 'neutral';
    }
}

// ============================================================
// 主题（浅色/深色 + 蓝/绿/黄/红四色）
// ============================================================

export const THEME_BRANDS = ['blue', 'green', 'yellow', 'red'] as const;
export type ThemeBrand = (typeof THEME_BRANDS)[number];

export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_STORAGE_KEY = 'ee_theme';
export const THEME_COOKIE_KEY = 'ee_theme';
export const DEFAULT_BRAND: ThemeBrand = 'green';
export const DEFAULT_MODE: ThemeMode = 'system';

export interface ThemeState {
    mode: ThemeMode;
    brand: ThemeBrand;
}

export function isThemeBrand(value: unknown): value is ThemeBrand {
    return typeof value === 'string' && (THEME_BRANDS as readonly string[]).includes(value);
}

export function isThemeMode(value: unknown): value is ThemeMode {
    return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);
}

/** 序列化为 `mode:brand`，供 cookie / localStorage 共用 */
export function serializeTheme(state: ThemeState): string {
    return `${state.mode}:${state.brand}`;
}

export function parseTheme(raw: string | null | undefined): ThemeState {
    if (!raw) return { mode: DEFAULT_MODE, brand: DEFAULT_BRAND };
    const [rawMode, rawBrand] = raw.split(':');
    return {
        mode: isThemeMode(rawMode) ? rawMode : DEFAULT_MODE,
        brand: isThemeBrand(rawBrand) ? rawBrand : DEFAULT_BRAND,
    };
}

/** 从 document.cookie 字符串中解析主题（SSR 里传 header 字符串即可） */
export function readThemeFromCookie(cookieHeader: string | null | undefined): ThemeState {
    if (!cookieHeader) return { mode: DEFAULT_MODE, brand: DEFAULT_BRAND };
    const match = cookieHeader
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${THEME_COOKIE_KEY}=`));
    if (!match) return { mode: DEFAULT_MODE, brand: DEFAULT_BRAND };
    return parseTheme(decodeURIComponent(match.slice(THEME_COOKIE_KEY.length + 1)));
}

/** mode + 系统偏好 → 是否应用深色 */
export function resolveDarkClass(mode: ThemeMode, prefersDark: boolean): boolean {
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return prefersDark;
}

/**
 * 把主题写到 <html> 上：
 * - `.dark` 类：Tailwind / Nuxt UI / Ionic 深色主题开关
 * - `data-brand`：四色主题令牌（theme.css 中的 --brand-*）
 * - `color-scheme`：让浏览器原生控件（滚动条、输入框）跟随
 */
export function applyThemeToElement(el: HTMLElement, state: ThemeState, prefersDark: boolean): void {
    const dark = resolveDarkClass(state.mode, prefersDark);
    el.classList.toggle('dark', dark);
    el.classList.toggle('ion-palette-dark', dark);
    el.dataset.brand = state.brand;
    el.style.colorScheme = dark ? 'dark' : 'light';
}

/** 四色主题的展示信息（两端切换器共用） */
export const BRAND_PRESETS: { value: ThemeBrand; label: string; labelEn: string; swatch: string }[] = [
    // swatch 取各品牌自身的 --brand-500（theme.css 中的 html[data-brand='x']），
    // 不能写成 var(--brand-500)，否则圆点会全部跟随当前品牌，失去预览作用。
    { value: 'blue', label: '蓝色', labelEn: 'Blue', swatch: 'oklch(62.3% 0.214 259.815)' },
    { value: 'green', label: '绿色', labelEn: 'Green', swatch: 'oklch(72.3% 0.219 149.579)' },
    { value: 'yellow', label: '黄色', labelEn: 'Yellow', swatch: 'oklch(79.5% 0.184 86.047)' },
    { value: 'red', label: '红色', labelEn: 'Red', swatch: 'oklch(63.7% 0.237 25.331)' },
];

export const MODE_PRESETS: { value: ThemeMode; label: string; labelEn: string; icon: string }[] = [
    { value: 'light', label: '浅色', labelEn: 'Light', icon: '☀️' },
    { value: 'dark', label: '深色', labelEn: 'Dark', icon: '🌙' },
    { value: 'system', label: '跟随系统', labelEn: 'System', icon: '🖥️' },
];
