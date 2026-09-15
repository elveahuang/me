import { sql } from 'drizzle-orm';
import { db } from '../utils/db';
import { WechatPayProvider } from '../utils/payments/wechat';
import { resolveModel } from '../utils/providers';
import { getRedisClient } from '../utils/redis';
import { isWechatOAuthConfigured } from '../utils/wechat';

/**
 * 云原生就绪/存活健康检查与诊断探针
 * GET /api/health
 */
export default defineEventHandler(async () => {
    const start = Date.now();
    const checks: Record<string, { status: 'up' | 'down' | 'degraded' | 'not_configured'; latencyMs?: number; message?: string }> = {};

    // 1. PostgreSQL 检查
    try {
        const dbStart = Date.now();
        await db.execute(sql`SELECT 1`);
        checks.database = { status: 'up', latencyMs: Date.now() - dbStart };
    } catch (e: any) {
        checks.database = { status: 'down', message: e?.message || 'Database connection error' };
    }

    // 2. Redis / 限流存储检查
    try {
        const redisStart = Date.now();
        const client = await getRedisClient();
        if (client) {
            await client.ping();
            checks.redis = { status: 'up', latencyMs: Date.now() - redisStart };
        } else {
            checks.redis = { status: 'degraded', message: 'Running on in-memory sliding window fallback' };
        }
    } catch (e: any) {
        checks.redis = { status: 'degraded', message: e?.message || 'Redis unreachable, fallback active' };
    }

    // 3. 微信服务检查
    const wechatPayConfigured = WechatPayProvider.shared().isConfigured();
    const wechatOAuthConfigured = isWechatOAuthConfigured();
    checks.wechat = {
        status: wechatPayConfigured && wechatOAuthConfigured ? 'up' : wechatPayConfigured || wechatOAuthConfigured ? 'degraded' : 'not_configured',
        message: `Pay: ${wechatPayConfigured ? 'enabled' : 'disabled'}, OAuth: ${wechatOAuthConfigured ? 'enabled' : 'disabled'}`,
    };

    // 4. AI 模型供应商
    try {
        const { provider, modelId } = await resolveModel();
        checks.modelProvider = {
            status: 'up',
            message: `Provider: ${provider.name} (${provider.baseUrl}), Default Model: ${modelId}`,
        };
    } catch (e: any) {
        checks.modelProvider = { status: 'degraded', message: e?.message || 'No valid AI provider found' };
    }

    // 存活（liveness）：数据库可用即可；就绪（readiness）：关键依赖（含模型供应商）都可用才能接流量
    const isHealthy = checks.database?.status === 'up';
    const isReady = isHealthy && checks.modelProvider?.status === 'up';

    return {
        status: !isHealthy ? 'unhealthy' : isReady ? 'healthy' : 'degraded',
        ready: isReady,
        timestamp: new Date().toISOString(),
        totalLatencyMs: Date.now() - start,
        checks,
        system: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            uptimeSeconds: Math.floor(process.uptime()),
            memory: {
                rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
                heapUsedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
                heapTotalMb: Math.round(process.memoryUsage().heapTotal / (1024 * 1024)),
            },
        },
    };
});
