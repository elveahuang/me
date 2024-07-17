import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router-dom';

const DemoIndexPage = lazy(() => import('@/views/extend/demo/index'));
const DemoXPlayerPage = lazy(() => import('@/views/extend/demo/x-player'));
const DemoVPlayerPage = lazy(() => import('@/views/extend/demo/v-player'));
const DemoShortVideoPage = lazy(() => import('@/views/extend/demo/short-video'));

export const demoRoutes: RouteObject[] = [
    {
        path: '/demo',
        children: [
            {
                path: 'index',
                element: <DemoIndexPage />,
            },
            {
                path: 'x-player',
                element: <DemoXPlayerPage />,
            },
            {
                path: 'v-player',
                element: <DemoVPlayerPage />,
            },
            {
                path: 'short-video',
                element: <DemoShortVideoPage />,
            },
            {
                path: '',
                element: <Navigate to={'index'} />,
            },
        ],
    },
];
