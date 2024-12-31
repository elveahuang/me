import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router';

const Index = lazy(() => import('@/views/extend/demo/index.tsx'));
const Player = lazy(() => import('@/views/extend/demo/player.tsx'));
const Canvas = lazy(() => import('@/views/extend/demo/canvas.tsx'));

export const demoRoutes: RouteObject[] = [
    {
        path: '/demo',
        children: [
            {
                path: 'index',
                element: <Index />,
            },
            {
                path: 'player',
                element: <Player />,
            },
            {
                path: 'canvas',
                element: <Canvas />,
            },
            {
                path: '',
                element: <Navigate to={'/demo/index'} />,
            },
        ],
    },
];
