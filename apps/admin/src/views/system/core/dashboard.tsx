import { dashboardApi, DashboardApiResult } from '@commons/core/api/admin';
import { R } from '@commons/core/types';
import { log } from '@commons/core/utils';
import { useMount } from 'ahooks';
import { useEffect } from 'react';

const Dashboard = () => {
    useEffect((): void => {
        dashboardApi().then((resp: R<DashboardApiResult>): void => {
            console.log(resp);
        });
    }, []);
    useMount(async (): Promise<void> => {
        log(`Page Dashboard mount...`);
    });
    return <div>Dashboard</div>;
};

export default Dashboard;
