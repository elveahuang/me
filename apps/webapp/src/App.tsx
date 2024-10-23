import { AppIntlProvider } from '@commons/core/i18n';
import { AppRouterProvider } from '@commons/core/router';
import { useRootDispatch, useUserSelector } from '@commons/core/store';
import { getUserInfoAsync, initializeAsync } from '@commons/core/store/actions';
import { log } from '@commons/core/utils';
import { AppHelmetProvider } from '@commons/core/utils/helmet';
import { AppLoading } from '@commons/webapp/components';
import { AntdConfigProvider } from '@commons/webapp/utils/antd';
import { useMount } from 'ahooks';
import { FC, Suspense, useState } from 'react';

const App: FC = () => {
    const [loading, setLoading] = useState(true);
    const { accessToken } = useUserSelector();
    const dispatch = useRootDispatch();

    useMount(async (): Promise<void> => {
        log(`Component App for webapp mount.`);
        try {
            await dispatch(initializeAsync());
            await dispatch(getUserInfoAsync(accessToken));
        } catch (e) {
            log(e);
        }
        setLoading(false);
    });

    return loading ? (
        <AppLoading />
    ) : (
        <AppIntlProvider>
            <AppHelmetProvider>
                <AntdConfigProvider>
                    <Suspense fallback={<AppLoading />}>
                        <AppRouterProvider />
                    </Suspense>
                </AntdConfigProvider>
            </AppHelmetProvider>
        </AppIntlProvider>
    );
};

export default App;
