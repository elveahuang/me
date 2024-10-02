import { lazyLoadComponent, RouteWrapper } from '@commons/core/router';
import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router-dom';

const Index = lazy(() => import('@/views/system/settings/index.tsx'));

export const settingsRoutes: RouteObject[] = [
    {
        path: 'system-settings/index',
        element: <RouteWrapper name={'system-settings-index-page'} authority={'workbench:dashboard'} element={lazyLoadComponent(Index)} />,
    },
    {
        path: '',
        element: <Navigate to={'/system-settings/index'} />,
    },
];
