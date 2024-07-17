import { coreRoutes } from '@/router/system/core.tsx';
import Tabs from '@/views/system/core/tabs.tsx';
import { lazy } from 'react';
import { RouteObject } from 'react-router-dom';

const Index = lazy(() => import('@/views/system/core/index.tsx'));
const Discover = lazy(() => import('@/views/system/core/discover.tsx'));
const Home = lazy(() => import('@/views/system/core/home.tsx'));
const Me = lazy(() => import('@/views/system/core/me.tsx'));
const Login = lazy(() => import('@/views/system/core/login.tsx'));
const About = lazy(() => import('@/views/system/core/about.tsx'));

export const systemRoutes: RouteObject[] = [
    {
        path: '/*',
        element: <Tabs />,
        children: [
            {
                path: 'home',
                element: <Home />,
            },
            {
                path: 'discover',
                element: <Discover />,
            },
            {
                path: 'me',
                element: <Me />,
            },
        ],
    },
    {
        path: '/',
        children: [...coreRoutes],
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
