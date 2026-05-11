import { setupI18n } from '@/i18n';
import { setupRouter } from '@/router';
import { routes } from '@/router/routes';
import { env } from '@/utils/env';

/**
 * 输出日志
 */
export function log(log: any): void {
    console.log(log);
}

export const setup = async (): Promise<void> => {
    setupRouter({ routes: routes, base: env.base }).then();
    setupI18n('zh').then();
};
