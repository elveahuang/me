import { auth } from '../utils/auth';

export default defineEventHandler((event) => {
    if (event.path.startsWith('/api/auth')) {
        return auth.handler(toWebRequest(event));
    }
});
