import App from '@/components/App';
import { setup } from '@/utils';
import { createRoot } from 'react-dom/client';

setup().then((): void => {
    const root = document.getElementById('root') as HTMLElement;
    createRoot(root).render(<App />);
});
