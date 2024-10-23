import { lazyLoadComponent, RouteWrapper } from '@commons/core/router';
import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router-dom';

const Index = lazy(() => import('@/views/system/attachment/index.tsx'));

export const attachmentRoutes: RouteObject[] = [
    {
        path: 'attachment/index',
        element: <RouteWrapper name={'attachment-index-page'} authority={'workbench:dashboard'} element={lazyLoadComponent(Index)} />,
    },
    {
        path: 'attachment',
        element: <Navigate to={'/attachment/index'} />,
    },
];
