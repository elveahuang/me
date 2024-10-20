import { lazyLoadComponent, RouteWrapper } from '@commons/core/router';
import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router-dom';

const Index = lazy(() => import('@/views/system/product/index.tsx'));

export const productRoutes: RouteObject[] = [
    {
        path: 'product/index',
        element: <RouteWrapper name={'product-index-page'} authority={'workbench:dashboard'} element={lazyLoadComponent(Index)} />,
    },
    {
        path: 'product',
        element: <Navigate to={'/product/index'} />,
    },
];
