import { R } from '@commons/core/types';
import { get } from '@commons/core/utils/http';

/**
 * 仪表盘
 */
export type DashboardApiResult = {
    //
};

export const dashboardApi = (): Promise<R<DashboardApiResult>> => {
    return get<R<DashboardApiResult>>('/api/admin/dashboard');
};

/**
 * 工作台
 */
export type WorkbenchApiResult = {
    //
};

export const workbenchApi = (): Promise<R<WorkbenchApiResult>> => {
    return get<R<WorkbenchApiResult>>('/api/admin/workbench');
};
