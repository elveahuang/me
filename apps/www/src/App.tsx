import { AppIntlProvider } from '@/i18n';
import { AppRouterProvider } from '@/router';
import { Suspense } from 'react';

const App = () => {
    return (
        <AppIntlProvider>
            <Suspense>
                <AppRouterProvider />
            </Suspense>
        </AppIntlProvider>
    );
};

export default App;
