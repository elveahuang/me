import WeComService from '@commons/core/services/we-com.service';
import { useRootSelector } from '@commons/core/store';
import { isAuthenticated } from '@commons/core/store/user';
import { log } from '@commons/core/utils';
import { hasAuthority } from '@commons/core/utils/auth';
import { AppLoading } from '@commons/webapp/components';
import { isEqual, isUndefined } from 'lodash-es';
import React, { FC, Suspense, useEffect } from 'react';
import type { RouteObject } from 'react-router-dom';
import { RouterProvider, createBrowserRouter, createHashRouter, useLocation } from 'react-router-dom';

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

/**
 * ---------------------------------------------------------------------------------------------------------------------
 * 路由权限包装
 * ---------------------------------------------------------------------------------------------------------------------
 */

export type RouteWrapperProps = React.PropsWithChildren<{
    name?: string;
    authority?: string | string[];
    element?: React.ReactNode | null;
}>;

export const RouteWrapper: FC<RouteWrapperProps> = (props: RouteWrapperProps) => {
    const location = useLocation();
    const { name, authority, element } = props;
    const { user } = useRootSelector((state) => state.user);
    const authenticated = useRootSelector(isAuthenticated);

    // 未登陆
    if (!authenticated) {
        log(`RouteWrapper unauthenticated - [${location.pathname}].`);
        if (WeComService.isWeCom() && WeComService.isWeComEnabled()) {
            WeComService.auth().then();
        }
    } else {
        log(`RouteWrapper authenticated - [${location.pathname}].`);
    }

    const result = isUndefined(authority) ? isAuthenticated : hasAuthority(authority, user?.authorities);
    if (isUndefined(authority)) {
        log(`AuthorizeRoute name [${name}] - check result - [${result}].`);
    } else {
        log(`AuthorizeRoute name [${name}] authority [${authority}] - check result - [${result}].`);
    }

    useEffect((): void => {
        log(location.pathname);
    }, [location.pathname]);

    return <>{element}</>;
};

export const lazyLoadComponent = (Component: any) => (
    <Suspense fallback={<AppLoading />}>
        <Component />
    </Suspense>
);
