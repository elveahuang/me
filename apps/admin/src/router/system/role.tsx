import { lazyLoadComponent, RouteWrapper } from '@commons/core/router';
import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router-dom';

const Index = lazy(() => import('@/views/system/user/index.tsx'));

export const roleRoutes: RouteObject[] = [
    {
        path: 'role/index',
        element: <RouteWrapper name={'role-index-page'} authority={'workbench:dashboard'} element={lazyLoadComponent(Index)} />,
    },
    {
        path: '',
        element: <Navigate to={'/role/index'} />,
    },
];
