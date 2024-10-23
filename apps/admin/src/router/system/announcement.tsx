import { lazyLoadComponent, RouteWrapper } from '@commons/core/router';
import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router-dom';

const Index = lazy(() => import('@/views/system/announcement/index.tsx'));

export const announcementRoutes: RouteObject[] = [
    {
        path: 'announcement/index',
        element: <RouteWrapper name={'announcement-index-page'} authority={'workbench:dashboard'} element={lazyLoadComponent(Index)} />,
    },
    {
        path: 'announcement',
        element: <Navigate to={'/announcement/index'} />,
    },
];
