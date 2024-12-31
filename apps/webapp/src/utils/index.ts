import { routes } from '@/router';
import { settings } from '@/settings';
import { env } from '@commons/core/env';
import { log } from '@commons/core/utils';
import { setHtmlTitle } from '@commons/core/utils/html.ts';
import { setupApp } from '@commons/webapp/utils';

export const setup = async (): Promise<void> => {
    log(`App for webapp initialize...`);
    await setupApp({ routes: routes, base: env.router.base, mode: env.router.mode }, initializeApp);
};

export const initializeApp = async (): Promise<any> => {
    const appTitle: string = settings.app.getTitle();
    setHtmlTitle(appTitle).then();
};
