/**
 * work 没有账号体系，任何能连到本机端口的人等价于「就是你」。
 * 只绑回环地址挡住了远程访问，但挡不住浏览器：用户打开的任意外站页面都能向
 * http://127.0.0.1:3001/api/... 发跨域 POST，写脏任务、笔记和供应商配置。
 *
 * 因此这里对写方法做来源核验：非浏览器客户端（SSR、定时任务、curl）不带 Origin，照常放行；
 * 带 Origin 时必须是本机来源。读方法不拦——跨域读还要求响应头授权，而 work 从不回显 Origin。
 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLocalOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    try {
        return LOCAL_HOSTS.has(new URL(origin).hostname);
    } catch {
        return false;
    }
}

export default defineEventHandler((event) => {
    const method = getMethod(event);
    if (method === 'OPTIONS') {
        // 没有跨域消费者，预检直接拒掉，省得回一串没人用的授权头
        setResponseStatus(event, 405);
        return '';
    }
    if (WRITE_METHODS.has(method) && !isLocalOrigin(getRequestHeader(event, 'origin'))) {
        throw createError({ statusCode: 403, statusMessage: '不允许来自本站之外的写入' });
    }
});
