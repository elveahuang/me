import { env } from '@commons/core/env';
import { AppIntlProvider } from '@commons/core/i18n';
import { AppRouterProvider } from '@commons/core/router';
import { useAppStore, useUserStore } from '@commons/core/store';
import { log } from '@commons/core/utils';
import { AppHelmetProvider } from '@commons/core/utils/helmet';
import { AppLoading } from '@commons/webapp/components';
import { AntdConfigProvider } from '@commons/webapp/utils/antd';
import { useMount } from 'ahooks';
import { Suspense, useState } from 'react';

const App = () => {
    const [loading, setLoading] = useState(true);
    const initialize = useAppStore((state) => state.initialize);
    const getUserInfo = useUserStore((state) => state.getUserInfo);

    useMount(async (): Promise<void> => {
        log(`Component App for admin mount.`);
        await initialize();
        await getUserInfo();
        setLoading(false);

        try {
            const socket = new WebSocket(env.socket.server);
            socket.addEventListener('connect', function () {
                console.log('Connected');
            });
        } catch (e) {
            console.log(e);
        }
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
