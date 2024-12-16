import { extendRoutes } from '@/router/extend';
import { systemRoutes } from '@/router/system';
import { RouteObject } from 'react-router';

export const routes: RouteObject[] = systemRoutes.concat(extendRoutes);
