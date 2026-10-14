/**
 * 环境配置审计：纯函数，不读 process.env、不依赖 Nitro 运行时。
 *
 * 分成两个消费者是有意的：
 * - `server/plugins/env-guard.ts` 在服务进程启动时调用，生产环境命中 `problems` 即拒绝启动。
 * - `server/db/seed.ts` 只借用 `isPlaceholderEnvValue()` 判断口令是否可用——seed 通常在
 *   终端里跑、`NODE_ENV` 并未设为 production，服务端的启动闸门完全管不到它。
 */

/** 一眼假的通用占位符片段（大小写不敏感）。 */
const PLACEHOLDER_MARKERS = ['replace-with', 'xxxx', 'example', 'changeme', 'your-'];

/**
 * `.env.example` 里给的是「抄了就能跑」的具体值而不是占位符，marker 匹配不到它们；
 * 而 README/deploy.md 的第一步就是 `cp .env.example .env`。仓库是公开的，
 * 这些字面量等同已泄露的密钥，只能逐个点名拒绝（比较时统一转小写）。
 */
const KNOWN_EXAMPLE_VALUES = [
    '382724cdde705bd5d5b79e21ec13df2e80ba2f014c163864dbb461d49450f83e', // .env.example 的 BETTER_AUTH_SECRET
    'admin@123', // .env.example 的 ADMIN_INITIAL_PASSWORD
];

/** better-auth 用它签名会话票据，短于这个长度就可以被离线枚举。 */
export const MIN_SECRET_LENGTH = 32;

/** 管理员初始口令的最低长度：公网实例上 8 位以下等于给 admin@example.com 半开门户。 */
export const MIN_ADMIN_PASSWORD_LENGTH = 10;

export function isPlaceholderEnvValue(value: string | undefined): boolean {
    const trimmed = value?.trim();
    if (!trimmed) return true;
    const lower = trimmed.toLowerCase();
    if (KNOWN_EXAMPLE_VALUES.includes(lower)) return true;
    return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

export interface EnvAudit {
    /** 用了会出事或密钥已公开：生产环境拒绝启动。 */
    problems: string[];
    /** 只提示，不阻塞启动。 */
    warnings: string[];
}

/**
 * `problems` 只放「这条配置本身不安全」的确定性问题，不做地址合法性之类的猜测。
 * 示例/占位的管理员口令归入 `warnings` 而不是 `problems`：seed 已经不再信任它的字面值
 * （见 `seed.ts`），而 README 的必填清单里并没有这一项，用它拒绝启动会把
 * 「管理员早已存在、只是环境变量沿用了示例文件」的存量部署在下次重启时直接变砖。
 */
export function auditEnv(env: NodeJS.ProcessEnv): EnvAudit {
    const problems: string[] = [];
    const warnings: string[] = [];

    const secret = env.BETTER_AUTH_SECRET?.trim();
    if (isPlaceholderEnvValue(secret)) {
        problems.push('BETTER_AUTH_SECRET 未设置或仍是示例占位符（请用 openssl rand -base64 32 生成）');
    } else if (secret && secret.length < MIN_SECRET_LENGTH) {
        problems.push(`BETTER_AUTH_SECRET 只有 ${secret.length} 字符，至少需要 ${MIN_SECRET_LENGTH} 字符`);
    }

    const adminPassword = env.ADMIN_INITIAL_PASSWORD?.trim();
    if (isPlaceholderEnvValue(adminPassword)) {
        warnings.push('ADMIN_INITIAL_PASSWORD 未设置或仍是示例占位符，seed 会忽略它并生成随机口令');
    } else if (adminPassword && adminPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
        problems.push(`ADMIN_INITIAL_PASSWORD 只有 ${adminPassword.length} 字符，至少需要 ${MIN_ADMIN_PASSWORD_LENGTH} 字符`);
    }

    if (!env.BETTER_AUTH_URL?.trim()) {
        problems.push('BETTER_AUTH_URL 未设置（生产环境必须显式配置对外地址）');
    }

    if (!env.POSTGRES_URL?.trim()) {
        problems.push('POSTGRES_URL 未设置，服务会回落到 server/utils/db.ts 里写死的 postgres://postgres:postgres@localhost:5432/ee');
    }

    return { problems, warnings };
}
