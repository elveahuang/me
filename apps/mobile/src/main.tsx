import App from '@/App';
import { setup } from '@/utils';
import { log } from '@commons/core/utils';
import '@commons/mobile/theme/default.scss';
import { createRoot } from 'react-dom/client';

setup().then((): void => {
    createRoot(document.getElementById('app') as HTMLElement).render(<App />);
    log(`App for mobile has been started.`);
});
