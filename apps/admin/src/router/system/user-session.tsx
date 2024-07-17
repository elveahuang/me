import { lazyLoadComponent, RouteWrapper } from '@commons/core/router';
import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router-dom';

const Index = lazy(() => import('@/views/system/user-session/index.tsx'));

export const userSessionRoutes: RouteObject[] = [
    {
        path: 'user-session/index',
        element: <RouteWrapper name={'user-session-index-page'} authority={'workbench:dashboard'} element={lazyLoadComponent(Index)} />,
    },
    {
        path: '',
        element: <Navigate to={'/user-session/index'} />,
    },
];
