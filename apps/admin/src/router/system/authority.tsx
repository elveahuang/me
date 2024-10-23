import { lazyLoadComponent, RouteWrapper } from '@commons/core/router';
import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router-dom';

const Index = lazy(() => import('@/views/system/product/index.tsx'));

export const authorityRoutes: RouteObject[] = [
    {
        path: 'authority/index',
        element: <RouteWrapper name={'authority-index-page'} authority={'workbench:dashboard'} element={lazyLoadComponent(Index)} />,
    },
    {
        path: '',
        element: <Navigate to={'/authority/index'} />,
    },
];
