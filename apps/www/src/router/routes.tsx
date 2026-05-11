import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router';

const Home = lazy(() => import('@/pages/home.tsx'));
const About = lazy(() => import('@/pages/about.tsx'));
const MainLayout = lazy(() => import('@/layouts/MainLayout.tsx'));

export const routes: RouteObject[] = [
    {
        path: '/',
        element: <MainLayout />,
        children: [
            {
                path: 'home',
                element: <Home />,
            },
            {
                path: 'about',
                element: <About />,
            },
            {
                path: '',
                element: <Navigate to={'home'} />,
            },
        ],
    },
];
