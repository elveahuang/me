import { log } from '@/utils';
import { isEqual } from 'es-toolkit/compat';
import { FC } from 'react';
import type { RouteObject } from 'react-router';
import { createBrowserRouter, createHashRouter, RouterProvider } from 'react-router';

/**
 * ---------------------------------------------------------------------------------------------------------------------
 * 官方推荐方式
 * ---------------------------------------------------------------------------------------------------------------------
 */

export class RouterConfig {
    mode?: string = 'history';
    base?: string = '';
    routes?: RouteObject[] = [];
    customWhiteList?: Array<string> = [];
}

export let router: ReturnType<typeof createBrowserRouter>;

export const setupRouter = async (config: RouterConfig): Promise<void> => {
    log(`Router [mode - ${config.mode}] initialize...`);
    if (isEqual(config.mode, 'hash')) {
        router = createHashRouter(config.routes, {});
    } else {
        router = createBrowserRouter(config.routes, {
            basename: config.base,
        });
    }
};

export const AppRouterProvider: FC = () => {
    return <RouterProvider router={router} />;
};
