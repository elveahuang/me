import { lazyLoadComponent, RouteWrapper } from '@commons/core/router';
import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router-dom';

const Dashboard = lazy(() => import('@/views/system/core/dashboard.tsx'));
const Workbench = lazy(() => import('@/views/system/core/workbench.tsx'));

export const coreRoutes: RouteObject[] = [
    {
        path: 'workbench',
        element: <RouteWrapper name={'workbench'} element={lazyLoadComponent(Workbench)} />,
    },
    {
        path: 'dashboard',
        element: <RouteWrapper name={'dashboard'} authority={'workbench:dashboard'} element={lazyLoadComponent(Dashboard)} />,
    },
    {
        path: '',
        element: <Navigate to={'workbench'} />,
    },
];
