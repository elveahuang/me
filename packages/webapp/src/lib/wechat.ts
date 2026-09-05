import { db } from '@/db';
import { account, session, user } from '@schema';
import { and, eq } from 'drizzle-orm';
import crypto from 'node:crypto';

/**
 * 微信公众号集成：
 * - 网页授权登录（snsapi_userinfo，需在微信内浏览器打开）
 * - 为 JSAPI 支付提供 openid 解析
 *
 * 凭据通过环境变量注入（见 .env.example）：
 * - WECHAT_OAUTH_APP_ID / WECHAT_OAUTH_APP_SECRET（公众号 appid/secret）
 * - WECHAT_OAUTH_REDIRECT_URL（可选，默认 {BETTER_AUTH_URL}/api/auth/wechat/callback）
 * - MOBILE_APP_URL（可选，配置后回调可跳回移动端并附带会话 token）
 *
 * 说明：微信 OAuth 与标准 OIDC 差异较大（appid 参数、token 以 query 返回、
 * userinfo 需携带 openid），不适合 genericOAuth 插件，这里实现完整自定义流程；
 * 会话通过直接写入 better-auth 的 session 表 + 会话 Cookie 建立，
 * 与密码登录在鉴权层面完全一致（webapp 用 Cookie，mobile/小程序用 Bearer）。
 */

const WECHAT_AUTHORIZE_URL = 'https://open.weixin.qq.com/connect/oauth2/authorize';
const WECHAT_TOKEN_URL = 'https://api.weixin.qq.com/sns/oauth2/access_token';
const WECHAT_USERINFO_URL = 'https://api.weixin.qq.com/sns/userinfo';
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

export function isWechatOAuthConfigured(): boolean {
    return Boolean(process.env.WECHAT_OAUTH_APP_ID && process.env.WECHAT_OAUTH_APP_SECRET);
}

export function isWechatInBrowser(userAgent: string): boolean {
    return /MicroMessenger/i.test(userAgent);
}

/** 构造公众号网页授权跳转地址 */
export function buildWechatAuthorizeUrl(params: { redirectUri: string; state: string; scope?: string }): string {
    const appId = process.env.WECHAT_OAUTH_APP_ID!;
    const query = new URLSearchParams({
        appid: appId,
        redirect_uri: params.redirectUri,
        response_type: 'code',
        scope: params.scope ?? 'snsapi_userinfo',
        state: params.state,
    });
    return `${WECHAT_AUTHORIZE_URL}?${query.toString()}#wechat_redirect`;
}

interface WechatTokenResponse {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    openid: string;
    scope?: string;
    unionid?: string;
    errcode?: number;
    errmsg?: string;
}

interface WechatUserInfo {
    openid: string;
    nickname?: string;
    headimgurl?: string;
    unionid?: string;
    errcode?: number;
    errmsg?: string;
}

/** 用授权码换取 access_token + openid */
export async function exchangeWechatCode(code: string): Promise<WechatTokenResponse> {
    const appId = process.env.WECHAT_OAUTH_APP_ID!;
    const secret = process.env.WECHAT_OAUTH_APP_SECRET!;
    const url = `${WECHAT_TOKEN_URL}?appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    const data = (await fetch(url).then((r) => r.json())) as WechatTokenResponse;
    if (data.errcode) throw new Error(`微信授权失败: ${data.errcode} ${data.errmsg ?? ''}`);
    return data;
}

/** 拉取微信用户资料（snsapi_userinfo） */
export async function fetchWechatUserInfo(accessToken: string, openid: string): Promise<WechatUserInfo> {
    const url = `${WECHAT_USERINFO_URL}?access_token=${encodeURIComponent(accessToken)}&openid=${encodeURIComponent(openid)}&lang=zh_CN`;
    const data = (await fetch(url).then((r) => r.json())) as WechatUserInfo;
    if (data.errcode) throw new Error(`获取微信用户信息失败: ${data.errcode} ${data.errmsg ?? ''}`);
    return data;
}

/** 按 openid 查找已绑定的本地账号 */
export async function findWechatAccount(openid: string): Promise<{ userId: string } | null> {
    const [row] = await db
        .select({ userId: account.userId })
        .from(account)
        .where(and(eq(account.providerId, 'wechat'), eq(account.accountId, openid)));
    return row ?? null;
}

/**
 * 创建或绑定微信用户：
 * - 已绑定 → 直接返回 userId
 * - 未绑定 → 事务内新建用户（邮箱用微信占位地址，不可用于密码登录）并写入 account 绑定
 * 并发安全：微信回调可能双发，email 由 openid 确定性生成，onConflictDoNothing + 回查保证幂等。
 */
export async function upsertWechatUser(openid: string, profile: { nickname?: string; headimgurl?: string }): Promise<string> {
    const existing = await findWechatAccount(openid);
    if (existing) return existing.userId;

    const name = profile.nickname?.trim() || '微信用户';
    const email = `wx_${openid.slice(0, 16)}@wechat.local`;

    return db.transaction(async (tx) => {
        await tx
            .insert(user)
            .values({
                id: crypto.randomUUID(),
                name,
                email,
                emailVerified: true,
                image: profile.headimgurl ?? null,
            })
            // 并发回调撞 email 唯一约束时忽略，回查复用已有用户
            .onConflictDoNothing({ target: user.email });

        const [created] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
        if (!created) throw new Error('微信用户创建失败');

        // 已有绑定时不再重复插入（防并发双插 account）
        const [bound] = await tx
            .select({ userId: account.userId })
            .from(account)
            .where(and(eq(account.providerId, 'wechat'), eq(account.accountId, openid)));
        if (!bound) {
            await tx.insert(account).values({
                id: crypto.randomUUID(),
                accountId: openid,
                providerId: 'wechat',
                issuer: 'https://open.weixin.qq.com',
                userId: created.id,
                accessToken: null,
                scope: 'snsapi_userinfo',
            });
        }
        return created.id;
    });
}

/** 创建 better-auth 会话（直接写 session 表；webapp 侧以 Cookie 下发，移动端以 Bearer 使用） */
export async function createWechatSession(params: { userId: string; userAgent?: string; ip?: string }): Promise<{ token: string; expiresAt: Date }> {
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000);
    await db.insert(session).values({
        id: crypto.randomUUID(),
        token,
        userId: params.userId,
        expiresAt,
        userAgent: params.userAgent ?? null,
        ipAddress: params.ip ?? null,
    });
    return { token, expiresAt };
}

/** 会话 Cookie（better-auth 默认 cookie 名；SameSite=Lax 兜底 CSRF） */
export function sessionCookie(token: string, maxAgeSec = SESSION_MAX_AGE_SEC): string {
    const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
    return `better-auth.session_token=${token}; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=${maxAgeSec}`;
}

/** 查询用户绑定的微信 openid（JSAPI 支付需要） */
export async function getWechatOpenid(userId: string): Promise<string | null> {
    const [row] = await db
        .select({ accountId: account.accountId })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, 'wechat')));
    return row?.accountId ?? null;
}

export type WechatRedirectTarget = { kind: 'web'; path: string } | { kind: 'mobile'; url: string } | null;

/**
 * 校验 OAuth 回跳地址（防开放重定向 / 防 #token 泄漏到外部域）：
 * - 绝对 URL：仅当 origin 与 MOBILE_APP_URL 完全一致时按移动端处理
 * - 相对路径：必须以单个 / 开头（排除 //evil.com 与 /\evil.com 协议相对绕过）
 * - 其余一律返回 null
 */
export function resolveWechatRedirect(raw: string | null): WechatRedirectTarget {
    const value = raw ?? '/chat';
    const mobileBase = process.env.MOBILE_APP_URL;
    if (mobileBase && /^https?:\/\//i.test(value)) {
        try {
            if (new URL(value).origin === new URL(mobileBase).origin) return { kind: 'mobile', url: value };
        } catch {
            // URL 解析失败按非法处理
        }
        return null;
    }
    if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) return { kind: 'web', path: value };
    return null;
}
