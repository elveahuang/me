import App from '@/App';
import { setup } from '@/utils';
import { log } from '@commons/core/utils';
import '@commons/webapp/theme/default.scss';
import { createRoot } from 'react-dom/client';

setup().then((): void => {
    createRoot(document.getElementById('app') as HTMLElement).render(<App />);
    log(`App for admin has been started.`);
});
