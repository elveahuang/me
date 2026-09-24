import { and, eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import { account, session, user } from '../db/schema';
import { auth } from './auth';
import { db } from './db';

/**
 * 微信公众号集成：
 * - 网页授权登录（snsapi_userinfo，需在微信内浏览器打开）
 * - 为 JSAPI 支付提供 openid 解析
 *
 * 凭据通过环境变量注入（见 .env.example）：
 * - WECHAT_OAUTH_APP_ID / WECHAT_OAUTH_APP_SECRET（公众号 appid/secret）
 * - WECHAT_OAUTH_REDIRECT_URL（可选，默认 {BETTER_AUTH_URL}/api/auth/wechat/callback）
 * - MOBILE_APP_URL（可选，配置后回调可跳回移动端并附带会话 token）
 */

const WECHAT_AUTHORIZE_URL = 'https://open.weixin.qq.com/connect/oauth2/authorize';
const WECHAT_TOKEN_URL = 'https://api.weixin.qq.com/sns/oauth2/access_token';
const WECHAT_USERINFO_URL = 'https://api.weixin.qq.com/sns/userinfo';
const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60; // 7 天
/** 微信开放接口是外部依赖：无鉴权回调可被反复触发，裸 fetch 挂起会长时间占住请求连接 */
const WECHAT_FETCH_TIMEOUT_MS = 10_000;

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
    const res = await fetch(url, { signal: AbortSignal.timeout(WECHAT_FETCH_TIMEOUT_MS) });
    const data = (await res.json()) as WechatTokenResponse;
    if (data.errcode) throw new Error(`微信授权失败: ${data.errcode} ${data.errmsg ?? ''}`);
    return data;
}

/** 拉取微信用户资料（snsapi_userinfo） */
export async function fetchWechatUserInfo(accessToken: string, openid: string): Promise<WechatUserInfo> {
    const url = `${WECHAT_USERINFO_URL}?access_token=${encodeURIComponent(accessToken)}&openid=${encodeURIComponent(openid)}&lang=zh_CN`;
    const res = await fetch(url, { signal: AbortSignal.timeout(WECHAT_FETCH_TIMEOUT_MS) });
    const data = (await res.json()) as WechatUserInfo;
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

/** 创建或复用微信用户（邮箱由 openid 全量哈希派生，避免截断前缀碰撞导致账号被合并） */
export async function upsertWechatUser(openid: string, profile: { nickname?: string; headimgurl?: string }): Promise<string> {
    const existing = await findWechatAccount(openid);
    if (existing) return existing.userId;

    const name = profile.nickname?.trim() || '微信用户';
    const email = `wx_${crypto.createHash('sha256').update(openid).digest('hex').slice(0, 32)}@wechat.local`;

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
            .onConflictDoNothing({ target: user.email });

        const [created] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
        if (!created) throw new Error('微信用户创建失败');

        const [bound] = await tx
            .select({ userId: account.userId })
            .from(account)
            .where(and(eq(account.providerId, 'wechat'), eq(account.accountId, openid)));
        if (!bound) {
            await tx.insert(account).values({
                id: crypto.randomUUID(),
                accountId: openid,
                providerId: 'wechat',
                userId: created.id,
                accessToken: null,
                scope: 'snsapi_userinfo',
            });
        }
        return created.id;
    });
}

/** 创建 better-auth 会话 */
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

/** 会话 Cookie（HMAC-SHA256 签名，适配 better-auth 1.7） */
export async function sessionCookie(token: string): Promise<string> {
    const ctx = await auth.$context;
    const signature = crypto.createHmac('sha256', ctx.secret).update(token).digest('base64');
    const value = encodeURIComponent(`${token}.${signature}`);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    return `${ctx.authCookies.sessionToken.name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SEC}${secure}`;
}

/** 查询用户绑定的微信 openid */
export async function getWechatOpenid(userId: string): Promise<string | null> {
    const [row] = await db
        .select({ accountId: account.accountId })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, 'wechat')));
    return row?.accountId ?? null;
}

export type WechatRedirectTarget = { kind: 'web'; path: string } | { kind: 'mobile'; url: string } | null;

export function resolveWechatRedirect(raw: string | null): WechatRedirectTarget {
    const value = raw ?? '/chat';
    const mobileBase = process.env.MOBILE_APP_URL;
    if (mobileBase && /^https?:\/\//i.test(value)) {
        try {
            if (new URL(value).origin === new URL(mobileBase).origin) return { kind: 'mobile', url: value };
        } catch {
            // ignore
        }
        return null;
    }
    if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) return { kind: 'web', path: value };
    return null;
}
