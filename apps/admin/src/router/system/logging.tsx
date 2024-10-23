import { lazyLoadComponent, RouteWrapper } from '@commons/core/router';
import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router-dom';

const Index = lazy(() => import('@/views/system/logging/index.tsx'));

export const loggingRoutes: RouteObject[] = [
    {
        path: 'logging/index',
        element: <RouteWrapper name={'logging-index-page'} authority={'workbench:dashboard'} element={lazyLoadComponent(Index)} />,
    },
    {
        path: '',
        element: <Navigate to={'/logging/index'} />,
    },
];
