import App from '@/App';
import '@/commons/theme/default.css';
import { setup } from '@/utils';
import { createRoot } from 'react-dom/client';

setup().then((): void => {
    createRoot(document.getElementById('app') as HTMLElement).render(<App />);
});
