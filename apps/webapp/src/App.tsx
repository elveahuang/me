import { AppIntlProvider } from '@commons/core/i18n';
import { AppRouterProvider } from '@commons/core/router';
import { useAppStore, useUserStore } from '@commons/core/store';
import { log } from '@commons/core/utils';
import { AppHelmetProvider } from '@commons/core/utils/helmet';
import { AppLoading } from '@commons/webapp/components';
import { AntdConfigProvider } from '@commons/webapp/utils/antd';
import { useMount } from 'ahooks';
import { FC, Suspense, useState } from 'react';

const App: FC = () => {
    const [loading, setLoading] = useState(true);
    const initialize = useAppStore((state) => state.initialize);
    const getUserInfo = useUserStore((state) => state.getUserInfo);

    useMount(async (): Promise<void> => {
        log(`Component App for webapp mount.`);
        try {
            await initialize();
            await getUserInfo();
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
