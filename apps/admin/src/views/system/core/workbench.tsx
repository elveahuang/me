import { workbenchApi, WorkbenchApiResult } from '@commons/core/api/admin';
import { R } from '@commons/core/types';
import { log } from '@commons/core/utils';
import { useMount } from 'ahooks';
import { useEffect } from 'react';

const Workbench = () => {
    useEffect((): void => {
        workbenchApi().then((resp: R<WorkbenchApiResult>): void => {
            console.log(resp);
        });
    }, []);
    useMount(async (): Promise<void> => {
        log(`Page Workbench mount...`);
    });
    return <div>Workbench</div>;
};

export default Workbench;
