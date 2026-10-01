import { createError } from 'h3';
import { normalizeAdminBoolean } from './admin-boolean';

/**
 * 内容运营（宣传栏 / 通知）共享的入参规范化。
 * 这些 handler 过去各写一份 normalizeLink/parseDate，且实现存在安全与语义分歧，收敛到此处统一维护。
 */

/**
 * 跳转链接规范化：只接受站内相对路径或 http/https 绝对地址。
 * - 空值返回 ''（表示无跳转）。
 * - 以单个 `/` 开头视为站内路径；但 `//host` 与 `/\host` 是协议相对地址，
 *   浏览器会按当前协议解析到任意外部域，必须拒绝，否则等于放开外链白名单。
 * - 其余要求可被 URL 解析且协议为 http/https，屏蔽 javascript:、data: 等危险协议。
 */
export function normalizeLink(raw: unknown): string {
    const value = String(raw ?? '').trim();
    if (!value) return '';
    assertContentLen(value, 2000, '跳转链接');
    if (value.startsWith('//') || value.startsWith('/\\')) {
        throw createError({ statusCode: 400, statusMessage: '跳转链接不支持协议相对地址' });
    }
    if (value.startsWith('/')) return value;
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw createError({ statusCode: 400, statusMessage: '跳转链接必须是 http/https 地址或以 / 开头的站内路径' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw createError({ statusCode: 400, statusMessage: '跳转链接仅允许 http/https 协议' });
    }
    return value;
}

/**
 * 时间窗入参解析：空值返回 null（表示不设边界），非法格式返回 400。
 */
export function parseDateInput(raw: unknown): Date | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const date = new Date(String(raw));
    if (Number.isNaN(date.getTime())) {
        throw createError({ statusCode: 400, statusMessage: '时间格式不正确' });
    }
    return date;
}

/**
 * 排序值规范化：整数列收到小数会被 PostgreSQL 拒为 22P02、超界拒为 22003，
 * 两者都会把 SQL 细节透出到响应体。缺省回退到 fallback，其余取整并夹到安全区间。
 */
export function normalizeSortOrder(raw: unknown, fallback = 0): number {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(Math.round(value), -1_000_000_000), 1_000_000_000);
}

/**
 * 内容类文本字段长度上限。这些 handler 已把入参统一 String() 化为字符串，
 * 剩下的风险是无限长直写；超长统一 400 而不是截断——静默截断正文比报错更难被发现。
 */
export function assertContentLen(value: string, maxChars: number, label: string): string {
    if (value.length > maxChars) {
        throw createError({ statusCode: 400, statusMessage: `${label} 过长（最多 ${maxChars} 字符）` });
    }
    return value;
}

const NEWS_FIELD_MAX: Record<string, { max: number; label: string }> = {
    title: { max: 200, label: '标题' },
    summary: { max: 500, label: '摘要' },
    content: { max: 200_000, label: '正文' },
    coverImage: { max: 500, label: '封面地址' },
    category: { max: 50, label: '分类' },
};

/** 资讯创建/编辑共用：按字段查表做长度校验，未知字段原样放行 */
export function assertNewsField(key: string, value: string): string {
    const rule = NEWS_FIELD_MAX[key];
    return rule ? assertContentLen(value, rule.max, rule.label) : value;
}

/** 标签归一：非数组视为空，去空后最多 10 个、单个最长 30 */
export function normalizeContentTags(raw: unknown): string[] {
    const list = Array.isArray(raw) ? raw.map((v) => String(v).trim()).filter(Boolean) : [];
    return list.slice(0, 10).map((tag) => tag.slice(0, 30));
}

const BULLETIN_FIELD_MAX: Record<string, { max: number; label: string }> = {
    title: { max: 200, label: '标题' },
    content: { max: 5000, label: '内容' },
    imageUrl: { max: 500, label: '图片地址' },
    linkText: { max: 50, label: '链接文案' },
};

/** 宣传栏创建/编辑共用：按字段查表做长度校验，未知字段原样放行 */
export function assertBulletinField(key: string, value: string): string {
    const rule = BULLETIN_FIELD_MAX[key];
    return rule ? assertContentLen(value, rule.max, rule.label) : value;
}

/** 资讯可编辑字段白名单：新建与更新共用，两条通道不再各持一份 */
const NEWS_EDITABLE = ['title', 'summary', 'content', 'coverImage', 'category', 'status'] as const;

export interface NewsBodyContext {
    /** 更新时传入现有行（补发布时间要读它）；新建不传 */
    existing?: { status: string; publishedAt: Date | null };
}

/**
 * 资讯新建(POST)与更新(PATCH)共用的请求体归一。
 *
 * 此前两份实现各自演化，已产生真实分叉：分类空值只有新建会回退 'general'（PATCH 把 ''
 * 直写列，用户端分类聚合随即多出一个空分类）；标题只有新建落库前 trim（PATCH 可存进
 * ' Title '）；发布时间补写规则也不一致——用户端按 desc(publishedAt) 排序且 PG 的
 * DESC 默认 NULLS FIRST，published 而 publishedAt 为 NULL 的文章会浮到非置顶区最前、
 * 日期列显示 '-'。这里把不变式收成一条：**最终 status='published' 时必须有发布时间**。
 *
 * 返回的 patch 只含请求体里出现过的字段（外加满足不变式时的 publishedAt）；
 * updatedAt 与新建时的列默认值仍由各 handler 自行补齐。
 */
export function normalizeNewsBody(body: Record<string, unknown>, ctx: NewsBodyContext = {}): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    for (const key of NEWS_EDITABLE) {
        if (body[key] === undefined) continue;
        let value = body[key] === null ? '' : String(body[key]);
        // status 只认两个合法值，其余按草稿处理，避免任意字符串直写列
        if (key === 'status') value = value === 'published' ? 'published' : 'draft';
        if (key === 'title') value = value.trim();
        patch[key] = assertNewsField(key, value);
    }
    if (patch.title !== undefined && !patch.title) {
        throw createError({ statusCode: 400, statusMessage: '标题必填' });
    }
    // 分类空值回退默认分类（此前仅新建如此）
    if (patch.category !== undefined && !patch.category) patch.category = 'general';
    if (body.tags !== undefined) patch.tags = normalizeContentTags(body.tags);
    if (body.pinned !== undefined) patch.pinned = normalizeAdminBoolean(body.pinned, 'pinned', false);
    if (body.publishedAt !== undefined) {
        // 不可解析的值会得到 Invalid Date，直写 timestamp 列会在驱动层抛错并透出内部细节
        patch.publishedAt = parseDateInput(body.publishedAt);
    }
    // 生效状态 = 本次改的，没改则沿用旧行（新建没改就是草稿）：
    // PATCH 只清 publishedAt、不动 status 时也要受不变式约束，不能从这条绕过去
    const effectiveStatus = patch.status ?? ctx.existing?.status ?? 'draft';
    if (effectiveStatus === 'published') {
        // 补时间的判据是「最终有没有值」：显式给了日期（含未来时间，定时发布）就尊重它；
        // 新建无旧行可查、更新读 ctx.existing.publishedAt。显式清空(null)在 published 下
        // 同样补回当前时间——这正是新建接口原有、PATCH 缺失的那半条不变式。
        const current = body.publishedAt !== undefined ? patch.publishedAt : (ctx.existing?.publishedAt ?? null);
        if (!current) patch.publishedAt = new Date();
    }
    return patch;
}
