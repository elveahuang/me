import { dashboardApi, DashboardApiResult } from '@commons/core/api/admin';
import { useRootSelector } from '@commons/core/store';
import { R } from '@commons/core/types';
import { log } from '@commons/core/utils';
import { useMount } from 'ahooks';
import { Button } from 'antd';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

const Dashboard = () => {
    const locale = useRootSelector((state) => state.app.locale);
    const { t } = useTranslation();

    useEffect((): void => {
        dashboardApi().then((resp: R<DashboardApiResult>): void => {
            console.log(resp);
        });
    }, []);

    useMount(async (): Promise<void> => {
        log(`Page Dashboard mount...`);
    });

    return (
        <div>
            <Link to={'/about'}>about</Link>
            {t('title', { ns: 'common' })}
            <Button type={'primary'}>{locale}</Button>
        </div>
    );
};

export default Dashboard;
