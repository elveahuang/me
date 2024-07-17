import { lazyLoadComponent, RouteWrapper } from '@commons/core/router';
import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router-dom';

const Index = lazy(() => import('@/views/system/user-center/index.tsx'));
const Notice = lazy(() => import('@/views/system/user-center/notice.tsx'));
const Account = lazy(() => import('@/views/system/user-center/account.tsx'));
const Password = lazy(() => import('@/views/system/user-center/password.tsx'));

export const userCenterRoutes: RouteObject[] = [
    {
        path: 'index',
        element: <RouteWrapper name={'user-center-index-page'} authority={'workbench:dashboard'} element={lazyLoadComponent(Index)} />,
    },
    {
        path: 'notice',
        element: <RouteWrapper name={'user-center-index-page'} authority={'workbench:dashboard'} element={lazyLoadComponent(Notice)} />,
    },
    {
        path: 'account',
        element: <RouteWrapper name={'user-center-index-page'} authority={'workbench:dashboard'} element={lazyLoadComponent(Account)} />,
    },
    {
        path: 'password',
        element: <RouteWrapper name={'user-center-index-page'} authority={'workbench:dashboard'} element={lazyLoadComponent(Password)} />,
    },
    {
        path: '',
        element: <Navigate to={'/user-center/index'} />,
    },
];
