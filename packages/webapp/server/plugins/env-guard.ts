/**
 * 环境变量安全闸门。
 *
 * 仓库里的 .env.example 是公开文件，任何"能被直接拿来跑起来"的示例密钥都等于公开密钥，
 * 因此这里在启动阶段校验：生产环境使用占位符/示例值时直接拒绝启动；
 * 开发环境给出醒目告警但不阻塞（本地调试零摩擦）。
 * 具体判定规则在 `server/utils/env-guard.ts`，seed 也复用同一份示例值识别。
 */
import { auditEnv } from '../utils/env-guard';

export default defineNitroPlugin(() => {
    const isProduction = process.env.NODE_ENV === 'production';
    const { problems, warnings } = auditEnv(process.env);

    for (const warning of warnings) {
        console.warn(`[env-guard] ${warning}`);
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
