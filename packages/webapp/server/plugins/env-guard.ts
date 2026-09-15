/**
 * 环境变量安全闸门。
 *
 * 仓库里的 .env.example 是公开文件，任何"能被直接拿来跑起来"的示例密钥都等于公开密钥，
 * 因此这里在启动阶段校验：生产环境使用占位符/示例值时直接拒绝启动；
 * 开发环境给出醒目告警但不阻塞（本地调试零摩擦）。
 */
const PLACEHOLDER_MARKERS = ['replace-with', 'xxxx', 'example', 'changeme', 'your-'];

function isPlaceholder(value: string | undefined): boolean {
    if (!value) return true;
    const lower = value.toLowerCase();
    return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

export default defineNitroPlugin(() => {
    const isProduction = process.env.NODE_ENV === 'production';
    const problems: string[] = [];

    if (isPlaceholder(process.env.BETTER_AUTH_SECRET)) {
        problems.push('BETTER_AUTH_SECRET 未设置或仍是示例占位符（请用 openssl rand -base64 32 生成）');
    }
    if (isPlaceholder(process.env.ADMIN_INITIAL_PASSWORD)) {
        problems.push('ADMIN_INITIAL_PASSWORD 未设置或仍是示例占位符');
    }
    if (!process.env.BETTER_AUTH_URL) {
        problems.push('BETTER_AUTH_URL 未设置（生产环境必须显式配置对外地址）');
    }

    if (!problems.length) {
        if (isProduction && process.env.MOCK_PAY_ENABLED === 'true') {
            console.warn('[env-guard] 生产环境已开启 MOCK_PAY_ENABLED，模拟支付会绕过真实收款，请确认这是有意行为');
        }
        return;
    }

    const message = `环境变量校验未通过：\n- ${problems.join('\n- ')}`;
    if (isProduction) {
        console.error(message);
        throw new Error('Insecure environment configuration, refusing to start in production');
    }
    console.warn(`[env-guard] ${message}\n（开发环境仅告警，生产环境会拒绝启动）`);
});
