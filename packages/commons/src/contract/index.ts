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

// ============================================================
// 会员 / 计费
// ============================================================

export type BillingPeriod = 'monthly' | 'yearly';
export type OrderStatus = 'pending' | 'paid' | 'closed' | 'refunded';

/**
 * 订单状态 → 徽章样式。web/mobile 共用同一套 app-badge-* 语义类名，
 * 收敛到此处避免四个页面各写一份且对 refunded 处理不一致。
 */
export const ORDER_STATUS_TONE: Record<string, string> = {
    paid: 'app-badge-success',
    pending: 'app-badge-warning',
    closed: 'app-badge-neutral',
    refunded: 'app-badge-info',
};

/** 订单状态 → i18n 文案键；各端 locales 的 billing 下需提供同名键 */
export const ORDER_STATUS_LABEL_KEY: Record<string, string> = {
    paid: 'billing.statusPaid',
    pending: 'billing.statusPending',
    closed: 'billing.statusClosed',
    refunded: 'billing.statusRefunded',
};

export function orderStatusTone(status: string): string {
    return ORDER_STATUS_TONE[status] ?? 'app-badge-neutral';
}

/** 返回文案键而非译文，交给调用方的 t() 渲染，避免契约层持有 i18n 实例 */
export function orderStatusLabelKey(status: string): string {
    return ORDER_STATUS_LABEL_KEY[status] ?? 'billing.statusClosed';
}

/**
 * tone / 通知级别 → 徽章样式类名。两端 JrBadge 与个人中心消息徽章共用，
 * 未知值回退 neutral，避免各组件再复制一份同名映射。
 */
export const BADGE_TONE: Record<string, string> = {
    info: 'app-badge-info',
    success: 'app-badge-success',
    warning: 'app-badge-warning',
    danger: 'app-badge-danger',
    neutral: 'app-badge-neutral',
};

export function badgeTone(tone: string | null | undefined): string {
    return BADGE_TONE[tone ?? 'neutral'] ?? 'app-badge-neutral';
}

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

/**
 * 年付相对月付（× 12）的折扣百分比，整数，例如 20 表示 -20%。
 * 仅在两档价格都有效且年付确实更便宜时返回，否则返回 null（该套餐不该出现折扣角标）；
 * 折扣必须由真实价格算出，不要在页面里写死 "-20%" 这类常量。
 */
export function yearlyDiscountPercent(plan: Plan): number | null {
    const monthly = plan.monthlyPriceCents;
    const yearly = plan.yearlyPriceCents;
    if (monthly === null || monthly === undefined || monthly <= 0) return null;
    if (yearly === null || yearly === undefined || yearly <= 0) return null;
    const fullYearPrice = monthly * 12;
    if (yearly >= fullYearPrice) return null;
    return Math.round((1 - yearly / fullYearPrice) * 100);
}

/** 套餐中最高的年付折扣，用于周期切换器上的角标；所有套餐都没有年付折扣时返回 null */
export function bestYearlyDiscountPercent(plans: Plan[]): number | null {
    let best: number | null = null;
    for (const plan of plans) {
        const percent = yearlyDiscountPercent(plan);
        if (percent !== null && percent > 0 && (best === null || percent > best)) best = percent;
    }
    return best;
}

/**
 * 该套餐是否为当前生效的付费套餐。
 *
 * 付费会员有到期时间，允许在到期前续费（服务端 activateMembership 会顺延到期时间），
 * 所以按钮应显示「续费」并可点击；free 档没有到期时间，永远只是展示态。
 */
export function isActivePaidPlan(plan: Plan, membership: Pick<MembershipStatus, 'plan' | 'expiresAt'> | null | undefined): boolean {
    if (!membership?.expiresAt) return false;
    return plan.code === membership.plan?.code;
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
    page?: number;
    pageSize?: number;
    /** 按用户全量统计（不随 category/keyword 筛选变化） */
    stats?: {
        totalCount: number;
        totalBytes: number;
        byCategory: { category: string; count: number; bytes: number }[];
    };
}

/** 单文件上传上限（MB）。导出是为了让调用方的文案能带上同一个数字，不再各写一份 */
export const ATTACHMENT_MAX_SIZE_MB = 20;

/** 本地校验失败的原因代码。契约只给代码，文案由调用方按当前语言翻译 */
export type AttachmentFileIssue = 'nameRequired' | 'fileEmpty' | 'fileTooLarge';

/** 上传前的本地校验：返回错误代码，通过返回 null（两端共用同一套规则） */
export function validateAttachmentFile(file: { name: string; size: number; type: string }, maxSizeMb = ATTACHMENT_MAX_SIZE_MB): AttachmentFileIssue | null {
    if (!file.name) return 'nameRequired';
    if (file.size <= 0) return 'fileEmpty';
    if (file.size > maxSizeMb * 1024 * 1024) return 'fileTooLarge';
    return null;
}

/** 字节数转可读体积（1.5 KB / 2.3 MB） */
export function formatBytes(size: number | null | undefined): string {
    const value = Math.max(0, Number(size) || 0);
    const units = ['B', 'KB', 'MB', 'GB'];
    const digits = [0, 1, 1, 2];
    let index = 0;
    let scaled = value;
    // 进档判据必须看「当前档位四舍五入后的展示值」而不是原始字节数：1048570 按原始值比较会停在 KB 档，
    // toFixed(1) 之后输出 1024.0 KB——KB 档没有 1024.0 这个值，且它与 1048576 字节的 1.0 MB 只差 6 字节。
    // 附件总大小来自 SQL SUM()，落在任意整数上，这类边界值必然会出现。
    while (index < units.length - 1 && Number(scaled.toFixed(digits[index])) >= 1024) {
        scaled /= 1024;
        index += 1;
    }
    return `${scaled.toFixed(digits[index])} ${units[index]}`;
}

// ============================================================
// 资讯新闻
// ============================================================

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
    /** 分类聚合，供筛选栏展示「分类名 (数量)」 */
    categories?: { value: string; count: number }[];
}

/** GET /api/news/:id 的响应：正文 + 相关推荐 + 本次是否计入浏览量 */
export interface NewsDetailResponse extends NewsArticle {
    related?: NewsSummary[];
    /** 浏览量按 (用户, 文章) 去重，false 表示该用户窗口内已读过，本次未计数 */
    viewCounted?: boolean;
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

/** 宣传栏列表的统一包装：`/api/bulletins`（按 position 过滤投放中的）与 `/api/admin/bulletins` 都返回该形状，两端 Banner 与管理端页不再各写一份内联类型 */
export interface BulletinListResponse {
    bulletins: BulletinRecord[];
}

/** 判断宣传栏当前是否在投放时间窗内（两端与管理端共用） */
export function isBulletinActive(bulletin: Pick<BulletinRecord, 'enabled' | 'startsAt' | 'endsAt'>, now = Date.now()): boolean {
    if (!bulletin.enabled) return false;
    if (bulletin.startsAt && new Date(bulletin.startsAt).getTime() > now) return false;
    if (bulletin.endsAt && new Date(bulletin.endsAt).getTime() < now) return false;
    return true;
}

/** 投放时间窗的覆盖范围描述，管理端列表展示用 */
export function bulletinWindowText(startsAt: string | null, endsAt: string | null, locale = 'zh-CN'): string {
    if (!startsAt && !endsAt) return locale === 'zh-CN' ? '长期有效' : 'Always on';
    return `${startsAt ? formatDate(startsAt, locale) : '—'} ~ ${endsAt ? formatDate(endsAt, locale) : '—'}`;
}

/**
 * `<input type="date">` 的日期字符串转投放时间窗边界。
 *
 * 关键点：结束日期必须覆盖「当天最后一刻」而不是当天 00:00。
 * 直接 `new Date('2026-09-20').toISOString()` 得到的是 00:00 UTC（北京时间 08:00），
 * 会让运营选了 9/20 的活动在 9/20 当天上午就提前下线。
 *
 * @param mode 'start' 取当天 00:00:00.000，'end' 取当天 23:59:59.999（均为本地时区）
 */
export function dateInputToBoundary(value: string | null | undefined, mode: 'start' | 'end'): Date | null {
    if (!value) return null;
    const [year, month, day] = value.split('-').map((part) => Number(part));
    if (!year || !month || !day) return null;
    const date = mode === 'start' ? new Date(year, month - 1, day, 0, 0, 0, 0) : new Date(year, month - 1, day, 23, 59, 59, 999);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** ISO 时间戳转 `<input type="date">` 需要的 YYYY-MM-DD（按本地时区，避免跨时区错一天） */
export function isoToDateInput(iso: string | null | undefined): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ============================================================
// 消息通知
// ============================================================

export type NotificationType = 'system' | 'announcement' | 'activity' | 'billing';
export type NotificationAudience = 'all' | 'users';

/** icon 是移动端通知列表用的展示图标；新增类型时同步补上，视图不再各写一份映射 */
export const NOTIFICATION_TYPES: { value: NotificationType; label: string; labelEn: string; icon: string }[] = [
    { value: 'system', label: '系统消息', labelEn: 'System', icon: '🔔' },
    { value: 'announcement', label: '平台公告', labelEn: 'Announcement', icon: '📢' },
    { value: 'activity', label: '活动通知', labelEn: 'Activity', icon: '🎁' },
    { value: 'billing', label: '账单提醒', labelEn: 'Billing', icon: '💳' },
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

/** extractApiError 的可选文案覆盖：由调用方按当前语言传入，未传时保留中文兜底 */
export interface ApiErrorLabels {
    /** status===401 且服务端未给文案时的展示 */
    unauthorized?: string;
    /** status===402 且服务端未给文案时的展示 */
    quotaExceeded?: string;
    /** status===429 且服务端未给文案时的展示 */
    rateLimited?: string;
}

/** 从 $fetch / fetch / Error 中提取可展示的错误文案 */
export function extractApiError(error: unknown, fallback = '操作失败，请稍后重试', labels: ApiErrorLabels = {}): string {
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
    if (status === 401) return labels.unauthorized ?? '登录状态已失效，请重新登录';
    if (status === 402) return labels.quotaExceeded ?? '今日额度已用完，升级会员可获得更多额度';
    if (status === 429) return labels.rateLimited ?? '操作过于频繁，请稍后再试';
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
    // 只认独立出现的 402：`includes('402')` 会把耗时、端口号等数字串误判成配额错误
    return /(?<!\d)402(?!\d)/.test(text) || text.includes('配额') || text.includes('额度');
}

/** 分转元，保留 2 位；null/undefined 视为 0 */
export function formatYuan(cents: number | null | undefined): string {
    if (cents === null || cents === undefined || Number.isNaN(cents)) return '0.00';
    return (cents / 100).toFixed(2);
}

/**
 * 展示用时区固定为北京时间，与计费日界（UTC+8）和 `server/utils/system-prompt.ts` 注入的时间同一口径。
 * 跟着主机时区有两个后果：容器默认 UTC 时，订单/会员到期时间整体早 8 小时（跨日还错一天）；
 * SSR 打出的字符串也与水合时浏览器所在时区不一致，同一时刻在首屏 HTML 和控制台里各说一套。
 */
const DISPLAY_TIME_ZONE = 'Asia/Shanghai';

/** 日期展示（两端一致） */
export function formatDate(iso: string | null | undefined, locale = 'zh-CN'): string {
    if (!iso) return '-';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString(locale, { timeZone: DISPLAY_TIME_ZONE });
}

/** 日期 + 24 小时制时间展示（两端一致） */
export function formatDateTime(iso: string | null | undefined, locale = 'zh-CN'): string {
    if (!iso) return '-';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString(locale, { hour12: false, timeZone: DISPLAY_TIME_ZONE });
}

/** 纯时刻展示（24 小时 HH:mm，两端一致）：同一天内的列表时间戳，日期冗余时用 */
export function formatTime(iso: string | null | undefined, locale = 'zh-CN'): string {
    if (!iso) return '-';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DISPLAY_TIME_ZONE });
}

/** 配额使用率（0-100），不限量返回 0 */
export function quotaUsedPercent(used: number | null | undefined, quota: number | null | undefined): number {
    if (!quota || quota <= 0) return 0;
    const safeUsed = Math.max(0, used ?? 0);
    return Math.min(100, Math.round((safeUsed / quota) * 100));
}

// ============================================================
// 主题（浅色/深色 + 蓝/绿/黄/红四色）
// ============================================================

export const THEME_BRANDS = ['blue', 'green', 'yellow', 'red'] as const;
export type ThemeBrand = (typeof THEME_BRANDS)[number];

export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_STORAGE_KEY = 'ee_theme';
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

/** 中英双语展示名的预置项形态（*_CATEGORIES / *_TYPES / *_LEVELS / *_POSITIONS / *_PRESETS 均符合） */
export interface PresetItem {
    label: string;
    labelEn: string;
}

/** 按当前语言取预置项的中/英文展示名 */
export function presetText(item: PresetItem, locale: string): string {
    return locale === 'en-US' ? item.labelEn : item.label;
}

/** 按 value 在预置表中查展示名并随语言取值；未命中时回显原值 */
export function presetLabelOf(entries: ({ value: string } & PresetItem)[], value: string, locale: string): string {
    const found = entries.find((item) => item.value === value);
    return found ? presetText(found, locale) : value;
}
