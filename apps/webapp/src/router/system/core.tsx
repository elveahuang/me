import { RouteWrapper } from '@commons/core/router';
import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router';

const Index = lazy(() => import('@/views/index'));
const About = lazy(() => import('@/views/about'));
const Profile = lazy(() => import('@/views/profile'));
const Player = lazy(() => import('@/views/player'));

export const coreRoutes: RouteObject[] = [
    {
        path: 'about',
        element: <About />,
    },
    {
        path: 'home',
        element: <Index />,
    },
    {
        path: 'profile',
        element: <RouteWrapper name={'profile-page'} element={<Profile />} />,
    },
    {
        path: 'player',
        element: <RouteWrapper name={'player-page'} element={<Player />} />,
    },
    {
        path: '',
        element: <Navigate to={'home'} />,
    },
];
