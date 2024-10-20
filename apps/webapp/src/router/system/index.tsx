import { MainLayout } from '@/layouts';
import { coreRoutes } from '@/router/system/core.tsx';
import { RouteWrapper } from '@commons/core/router';
import { RouteObject } from 'react-router-dom';

export const systemRoutes: RouteObject[] = [
    {
        path: '/',
        element: <RouteWrapper name={'main-layout'} element={<MainLayout />} />,
        children: [...coreRoutes],
    },
];
