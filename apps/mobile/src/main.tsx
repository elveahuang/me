import App from '@/App';
import { setup } from '@/utils';
import { store } from '@commons/core/store';
import { log } from '@commons/core/utils';
import '@commons/mobile/theme/default.scss';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';

setup().then((): void => {
    createRoot(document.getElementById('app') as HTMLElement).render(
        <Provider store={store}>
            <App />
        </Provider>,
    );
    log(`App for mobile has been started.`);
});
