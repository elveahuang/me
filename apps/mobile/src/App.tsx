import { AppIntlProvider } from '@commons/core/i18n';
import { AppRouterProvider } from '@commons/core/router';
import { useAppStore, useUserStore } from '@commons/core/store';
import { log } from '@commons/core/utils';
import { AppHelmetProvider } from '@commons/core/utils/helmet';
import { AppLoading } from '@commons/mobile/components';
import { AntdMobileConfigProvider } from '@commons/mobile/utils/antd';
import { useMount } from 'ahooks';
import { FC, Suspense, useState } from 'react';

const App: FC = () => {
    const [loading, setLoading] = useState(false);
    const initialize = useAppStore((state) => state.initialize);
    const getUserInfo = useUserStore((state) => state.getUserInfo);

    useMount(async () => {
        log(`Component App for mobile mount.`);
        await initialize();
        await getUserInfo();
        setLoading(false);
    });

    return loading ? (
        <AppLoading />
    ) : (
        <AppIntlProvider>
            <AppHelmetProvider>
                <AntdMobileConfigProvider>
                    <Suspense fallback={<AppLoading />}>
                        <AppRouterProvider />
                    </Suspense>
                </AntdMobileConfigProvider>
            </AppHelmetProvider>
        </AppIntlProvider>
    );
};

export default App;
