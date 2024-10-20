import { lazyLoadComponent, RouteWrapper } from '@commons/core/router';
import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router-dom';

const Index = lazy(() => import('@/views/system/dictionary/index.tsx'));

export const dictionaryRoutes: RouteObject[] = [
    {
        path: 'dictionary/index',
        element: <RouteWrapper name={'dictionary-index-page'} authority={'workbench:dashboard'} element={lazyLoadComponent(Index)} />,
    },
    {
        path: 'dictionary',
        element: <Navigate to={'/dictionary/index'} />,
    },
];
