import { IonApp, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './lib/auth';

/* Ionic 核心样式 */
import '@ionic/react/css/core.css';
import '@ionic/react/css/display.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Tailwind v4 + Konsta UI（备选组件层）样式 */
import './styles/tailwind.css';

import { AppRoutes } from './routes';

setupIonicReact();

const container = document.getElementById('root');
if (!container) throw new Error('root 元素不存在');
createRoot(container).render(
    <React.StrictMode>
        <AuthProvider>
            <IonApp>
                <IonReactRouter>
                    <AppRoutes />
                </IonReactRouter>
            </IonApp>
        </AuthProvider>
    </React.StrictMode>,
);
