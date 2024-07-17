import { MainLayout, UserLayout } from '@/layouts';
import { announcementRoutes } from '@/router/system/announcement.tsx';
import { attachmentRoutes } from '@/router/system/attachment.tsx';
import { authorityRoutes } from '@/router/system/authority.tsx';
import { coreRoutes } from '@/router/system/core.tsx';
import { dictionaryRoutes } from '@/router/system/dictionary.tsx';
import { loggingRoutes } from '@/router/system/logging.tsx';
import { productRoutes } from '@/router/system/product.tsx';
import { roleRoutes } from '@/router/system/role.tsx';
import { settingsRoutes } from '@/router/system/settings.tsx';
import { userCenterRoutes } from '@/router/system/user-center.tsx';
import { userSessionRoutes } from '@/router/system/user-session.tsx';
import { userRoutes } from '@/router/system/user.tsx';
import { RouteWrapper } from '@commons/core/router';
import { lazy } from 'react';
import { RouteObject } from 'react-router-dom';

const Index = lazy(() => import('@/views/system/core/index.tsx'));
const Login = lazy(() => import('@/views/system/core/login.tsx'));
const About = lazy(() => import('@/views/system/core/about.tsx'));

export const systemRoutes: RouteObject[] = [
    {
        path: '/',
        element: <RouteWrapper name={'main-layout'} element={<MainLayout />} />,
        children: [
            ...announcementRoutes,
            ...productRoutes,
            ...authorityRoutes,
            ...attachmentRoutes,
            ...dictionaryRoutes,
            ...loggingRoutes,
            ...roleRoutes,
            ...settingsRoutes,
            ...userRoutes,
            ...userSessionRoutes,
            ...coreRoutes,
        ],
    },
    {
        path: '/user-center',
        element: <RouteWrapper name={'user-layout'} element={<UserLayout />} />,
        children: [...userCenterRoutes],
    },
    {
        path: 'index',
        element: <Index />,
    },
    {
        path: 'about',
        element: <About />,
    },
    {
        path: 'login',
        element: <Login />,
    },
];
