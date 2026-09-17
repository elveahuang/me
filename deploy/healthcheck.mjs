/**
 * 容器健康检查。
 *
 * /api/health 无论健康与否都返回 HTTP 200（状态体现在响应体里），
 * 因此不能只用 curl -f 判断，必须解析 JSON。
 *
 * 判定标准为「数据库可用」：
 * - 全新部署尚未配置模型供应商时，ready 为 false 属于正常状态
 * - 若以 ready 作为存活条件，首次部署的容器会被反复重启
 *
 * 只用 Node 内置能力实现，运行镜像无需额外安装 curl。
 */
const port = process.env.NITRO_PORT || process.env.PORT || 3000;

try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(4000),
    });
    const body = await response.json();
    const databaseUp = body?.checks?.database?.status === 'up';

    if (!response.ok || !databaseUp) {
        console.error(`[healthcheck] 未通过：http=${response.status} database=${body?.checks?.database?.status}`);
        process.exit(1);
    }
    process.exit(0);
} catch (error) {
    console.error('[healthcheck] 探针请求失败:', error instanceof Error ? error.message : error);
    process.exit(1);
}
