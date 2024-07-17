import { AppIntlProvider } from '@commons/core/i18n';
import { AppRouterProvider } from '@commons/core/router';
import { useRootDispatch, useUserSelector } from '@commons/core/store';
import { getUserInfoAsync, initializeAsync } from '@commons/core/store/actions';
import { log } from '@commons/core/utils';
import { AppHelmetProvider } from '@commons/core/utils/helmet';
import { AppSwrConfigProvider } from '@commons/core/utils/swr';
import { AppLoading } from '@commons/mobile/components';
import { AntdMobileConfigProvider } from '@commons/mobile/utils/antd';
import { useMount } from 'ahooks';
import { FC, Suspense, useState } from 'react';

const App: FC = () => {
    const [loading, setLoading] = useState(false);
    const { accessToken } = useUserSelector();
    const dispatch = useRootDispatch();

    useMount(async () => {
        log(`Component App for mobile mount.`);
        await dispatch(initializeAsync());
        await dispatch(getUserInfoAsync(accessToken));
        setLoading(false);
    });

    return loading ? (
        <AppLoading />
    ) : (
        <AppIntlProvider>
            <AppHelmetProvider>
                <AppSwrConfigProvider>
                    <AntdMobileConfigProvider>
                        <Suspense fallback={<AppLoading />}>
                            <AppRouterProvider />
                        </Suspense>
                    </AntdMobileConfigProvider>
                </AppSwrConfigProvider>
            </AppHelmetProvider>
        </AppIntlProvider>
    );
};

export default App;
