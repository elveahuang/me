import { AppIntlProvider } from '@commons/core/i18n';
import { AppRouterProvider } from '@commons/core/router';
import { RootDispatch, useRootDispatch, useUserSelector } from '@commons/core/store';
import { getUserInfoAsync, initializeAsync } from '@commons/core/store/actions';
import { log } from '@commons/core/utils';
import { AppHelmetProvider } from '@commons/core/utils/helmet';
import { AppSwrConfigProvider } from '@commons/core/utils/swr';
import { AppLoading } from '@commons/webapp/components';
import { AntdConfigProvider } from '@commons/webapp/utils/antd';
import { useMount } from 'ahooks';
import { Suspense, useState } from 'react';

const App = () => {
    const [loading, setLoading] = useState(true);
    const { accessToken } = useUserSelector();
    const dispatch: RootDispatch = useRootDispatch();

    useMount(async (): Promise<void> => {
        log(`Component App for admin mount.`);
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
                    <AntdConfigProvider>
                        <Suspense fallback={<AppLoading />}>
                            <AppRouterProvider />
                        </Suspense>
                    </AntdConfigProvider>
                </AppSwrConfigProvider>
            </AppHelmetProvider>
        </AppIntlProvider>
    );
};

export default App;
