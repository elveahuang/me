import { extendRoutes } from '@/router/extend';
import { systemRoutes } from '@/router/system';
import { concat } from 'lodash-es';
import { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = concat(systemRoutes, extendRoutes);
