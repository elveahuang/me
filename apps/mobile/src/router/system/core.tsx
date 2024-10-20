import WeCom from '@/views/system/core/wecom.tsx';
import { RouteWrapper } from '@commons/core/router';
import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router-dom';

const Index = lazy(() => import('@/views/system/core/index'));
const About = lazy(() => import('@/views/system/core/about'));
const Profile = lazy(() => import('@/views/system/core/profile'));

export const coreRoutes: RouteObject[] = [
    {
        path: 'index',
        element: <Index />,
    },
    {
        path: 'profile',
        element: <RouteWrapper name={'profile-page'} element={<Profile />} />,
    },
    {
        path: 'about',
        element: <About />,
    },
    {
        path: 'wecom',
        element: <WeCom />,
    },
    {
        path: '',
        element: <Navigate to={'home'} />,
    },
];
