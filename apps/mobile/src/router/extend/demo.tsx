import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router';

const DemoIndexPage = lazy(() => import('@/views/extend/demo/index'));
const DemoPlayerPage = lazy(() => import('@/views/extend/demo/player'));
const DemoLottiePage = lazy(() => import('@/views/extend/demo/lottie'));
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
                path: 'player',
                element: <DemoPlayerPage />,
            },
            {
                path: 'lottie',
                element: <DemoLottiePage />,
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
