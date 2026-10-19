import { sendRedirect } from 'h3';
import { requireMethod } from '../../../utils/method';
import { routeId } from '../../../utils/route-id';

export default defineEventHandler((event) => {
    requireMethod(event, ['POST']);
    const id = routeId(event, 'id', '会话');
    return sendRedirect(event, `/api/conversations/${encodeURIComponent(id)}/compact`, 307);
});
