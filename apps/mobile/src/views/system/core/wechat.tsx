import { weComLoginApi } from '@commons/core/api/wechat.ts';
import { log } from '@commons/core/utils';
import { AppLoading } from '@commons/mobile/components';
import { useMount } from 'ahooks';
import { isEmpty } from 'lodash-es';
import { useSearchParams } from 'react-router-dom';

const WeCom = () => {
    const [searchParams] = useSearchParams();

    useMount(() => {
        log(`Mobile WeCom code - ${searchParams.get('code')}`);
        log(`Mobile WeCom state - ${searchParams.get('state')}`);
        const code = searchParams.has('code') ? searchParams.get('code') : '';
        if (!isEmpty(code)) {
            weComLoginApi({ code: code }).then();
        }
    });

    return <AppLoading />;
};

export default WeCom;
