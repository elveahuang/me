/**
 * 环境配置审计：纯函数，不读 process.env、不依赖 Nitro 运行时。
 *
 * 只审计 work 真正读取的变量（POSTGRES_URL / REDIS_URL / ALLOW_PRIVATE_OUTBOUND）。
 * fork 自 webapp 时这里还挂着 BETTER_AUTH_SECRET、
 * BETTER_AUTH_URL、ADMIN_INITIAL_PASSWORD 三条——work 在 P2 已整条抽掉账号层，
 * 代码里没有任何消费者，而 `.env.example` 也不提供它们：照文档配置好的部署
 * 在生产环境会被这三条误判成「密钥不安全」直接拒绝启动。
 *
 * `server/plugins/env-guard.ts` 在服务进程启动时调用：生产环境命中 `problems` 即拒绝启动，
 * 开发环境只告警（本地调试零摩擦）。
 */

export interface EnvAudit {
    /** 用了会出事：生产环境拒绝启动。 */
    problems: string[];
    /** 只提示，不阻塞启动。 */
    warnings: string[];
}

/**
 * 通用占位符标记：`.env.example` 里「抄了就能跑」的那类值。work 没有账号层，
 * 不需要 webapp 那套点名具体 secret 的逻辑，只要认得出示例串即可。
 * 刻意不收 `example`——`redis.example.com` 是合法主机名，会误报。
 */
const PLACEHOLDER_MARKERS = ['replace-with', 'replace-me', 'changeme', 'placeholder', 'your-', 'xxxxxxxx', 'todo'];

/** 视为「只监听本机」的主机名。`0.0.0.0`/`::`/空都不在这里。 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * work 没有账号体系，「只绑回环地址」是唯一真正把局域网挡在外面的边界
 * （`local-guard` 只看 Origin，而非浏览器客户端根本不带 Origin，照单全收）。
 *
 * 而 nitro 的 node preset 读的是 `NITRO_HOST`/`HOST` 环境变量，**不解析 `--host` 命令行参数**
 * （实测：`node .output/server/index.mjs --host 127.0.0.1` 仍然 `TCP 0.0.0.0:3101 LISTENING`）。
 * 也就是说按「加个 --host 就行」的直觉部署，产出物默认绑到所有网卡上，
 * 私人工作台（定时任务、供应商密钥管理表单、聊天）对整个局域网可读写。
 */
function checkBindHost(env: NodeJS.ProcessEnv, problems: string[], warnings: string[]): void {
    const host = (env.NITRO_HOST || env.HOST || '').trim();
    const isProduction = (env.NODE_ENV || '').toLowerCase() === 'production';

    if (!host) {
        const message = '未设置 NITRO_HOST，生产构建会监听 0.0.0.0（局域网可读写全部工作台数据）；应设为 127.0.0.1';
        if (isProduction) problems.push(message);
        else warnings.push(message);
        return;
    }
    if (LOOPBACK_HOSTS.has(host.toLowerCase())) return;
    if (env.WORK_ALLOW_PUBLIC_BIND?.trim().toLowerCase() === 'true') {
        warnings.push(`NITRO_HOST=${host} 不是回环地址，且已用 WORK_ALLOW_PUBLIC_BIND=true 显式放行——work 无鉴权，请确认网络边界`);
        return;
    }
    problems.push(`NITRO_HOST=${host} 不是回环地址，而 work 没有任何鉴权层；如确需对外监听，请自行加反代鉴权并设 WORK_ALLOW_PUBLIC_BIND=true`);
}

/**
 * work 只监听 127.0.0.1，唯一的硬约束是数据库地址：`server/utils/db.ts` 在缺失时
 * 会静默回落到写死的本机连接串，于是「忘了配库」表现为连到另一个默认库而不是报错。
 */
export function auditEnv(env: NodeJS.ProcessEnv): EnvAudit {
    const problems: string[] = [];
    const warnings: string[] = [];

    if (!env.POSTGRES_URL?.trim()) {
        problems.push('POSTGRES_URL 未设置，服务会静默回落到 server/utils/db.ts 里写死的本机默认库');
    }

    checkBindHost(env, problems, warnings);

    const redisUrl = env.REDIS_URL?.trim();
    if (redisUrl && PLACEHOLDER_MARKERS.some((marker) => redisUrl.toLowerCase().includes(marker))) {
        warnings.push('REDIS_URL 像是占位符，限流与缓存会降级为进程内存模式（单进程可忽略，多实例下限额不全局一致）');
    }

    if (env.ALLOW_PRIVATE_OUTBOUND?.trim().toLowerCase() === 'true') {
        warnings.push('ALLOW_PRIVATE_OUTBOUND=true：HTTP 工具与 MCP 可访问内网/回环地址，确认是本机自建服务的需要再开');
    }

    return { problems, warnings };
}
