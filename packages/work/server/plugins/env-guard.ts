/**
 * 环境变量安全闸门。
 *
 * 生产环境命中 `problems` 直接拒绝启动；开发环境给出醒目告警但不阻塞（本地调试零摩擦）。
 * 具体判定规则在 `server/utils/env-guard.ts`。
 */
import { auditEnv } from '../utils/env-guard';

export default defineNitroPlugin(() => {
    const isProduction = process.env.NODE_ENV === 'production';
    const { problems, warnings } = auditEnv(process.env);

    for (const warning of warnings) {
        console.warn(`[env-guard] ${warning}`);
    }

    if (!problems.length) return;

    const message = `环境变量校验未通过：\n- ${problems.join('\n- ')}`;
    if (isProduction) {
        console.error(message);
        throw new Error('Insecure environment configuration, refusing to start in production');
    }
    console.warn(`[env-guard] ${message}\n（开发环境仅告警，生产环境会拒绝启动）`);
});
