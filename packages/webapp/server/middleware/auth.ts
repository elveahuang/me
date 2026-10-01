import { auth } from '../utils/auth';

/**
 * 本项目自建的、也挂在 /api/auth 前缀下的端点。
 *
 * better-auth 的 router 对没注册的路径直接返回 404，而 Nitro 中间件先于文件路由执行，
 * 所以只要把这些路径交给 auth.handler，对应的 handler 就永远不会被调用
 * （微信登录的发起、状态探测与回调整个链路都会静默变成 404）。
 */
const OWN_PREFIXES = ['/api/auth/wechat'];

function isOwnAuthRoute(path: string): boolean {
    // event.path 带查询串，必须先剥掉再比较：/api/auth/wechat?redirect=… 既不等于也不以 "/api/auth/wechat/" 开头
    const pathname = path.split('?')[0]!;
    return OWN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default defineEventHandler((event) => {
    if (event.path.startsWith('/api/auth') && !isOwnAuthRoute(event.path)) {
        return auth.handler(toWebRequest(event));
    }
});
