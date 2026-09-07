import { AuthProvider } from '@/lib/auth';
import { AppRoutes } from '@/routes.tsx';
import '@/styles/theme.css';
import { IonApp } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { KonstaProvider } from 'konsta/react';
import type { FC, JSX } from 'react';

const App: FC = (): JSX.Element => {
    return (
        <KonstaProvider theme='parent'>
            <AuthProvider>
                <IonApp>
                    <IonReactRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
                        <AppRoutes />
                    </IonReactRouter>
                </IonApp>
            </AuthProvider>
        </KonstaProvider>
    );
};

export default App;
