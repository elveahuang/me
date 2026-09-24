import { sql } from 'drizzle-orm';
import { db } from '../utils/db';
import { WechatPayProvider } from '../utils/payments/wechat';
import { peekModelAvailability } from '../utils/providers';
import { getRedisClient } from '../utils/redis';
import { isWechatOAuthConfigured } from '../utils/wechat';

/**
 * 容器编排用的健康探针：GET /api/health
 *
 * 设计约束：
 * - **无副作用**：本接口不需要鉴权，因此绝不能写库。模型供应商检查走只读的
 *   peekModelAvailability()，而不是会插入默认行的 resolveModel()。
 * - **不泄露内部信息**：不返回供应商地址、数据库错误原文、Node 版本、内存与平台信息——
 *   这些只对运维有用，对未鉴权的公网请求属于信息泄露。需要细节时看服务端日志。
 * - 恒返回 HTTP 200，状态体现在响应体：编排系统普遍用「探针能否连上」判断存活，
 *   而是否就绪（ready）由 checks 决定，避免首次部署未配置模型时容器被反复重启。
 */
export default defineEventHandler(async (event) => {
    const start = Date.now();
    const checks: Record<string, { status: 'up' | 'down' | 'degraded' | 'not_configured' }> = {};

    // 1. PostgreSQL
    try {
        await db.execute(sql`SELECT 1`);
        checks.database = { status: 'up' };
    } catch {
        // 错误原文可能包含连接串、主机名等信息，不对外输出
        checks.database = { status: 'down' };
    }

    // 2. Redis / 限流存储（未配置时降级为单进程内存）
    try {
        const client = await getRedisClient();
        if (client) {
            await client.ping();
            checks.redis = { status: 'up' };
        } else {
            checks.redis = { status: 'degraded' };
        }
    } catch {
        checks.redis = { status: 'degraded' };
    }

    // 3. 微信支付与登录（均未配置时视为 not_configured，而非故障）
    try {
        const payConfigured = WechatPayProvider.shared().isConfigured();
        const oauthConfigured = isWechatOAuthConfigured();
        checks.wechat = { status: payConfigured && oauthConfigured ? 'up' : payConfigured || oauthConfigured ? 'degraded' : 'not_configured' };
    } catch {
        checks.wechat = { status: 'degraded' };
    }

    // 4. AI 模型供应商（只读探测）
    try {
        const availability = await peekModelAvailability();
        checks.modelProvider = { status: availability.available ? 'up' : 'not_configured' };
    } catch {
        checks.modelProvider = { status: 'degraded' };
    }

    // 存活：数据库可用；就绪：关键依赖（含模型供应商）都可用才能接流量
    const isHealthy = checks.database?.status === 'up';
    const isReady = isHealthy && checks.modelProvider?.status === 'up';

    // 便于日志排查：服务端记录详情，响应体只给状态
    if (event) {
        setHeader(event, 'Cache-Control', 'no-store');
    }

    return {
        status: !isHealthy ? 'unhealthy' : isReady ? 'healthy' : 'degraded',
        ready: isReady,
        timestamp: new Date().toISOString(),
        totalLatencyMs: Date.now() - start,
        checks,
    };
});
