/**
 * CORS 处理（此前 CORS_ORIGINS 只是一份没人读取的死配置）。
 *
 * 允许来源 = CORS_ORIGINS（逗号分隔） + BETTER_AUTH_URL + 本地开发 / 原生壳默认地址。
 * 浏览器端仍受 Cookie 的 SameSite=Lax 约束，跨域请求需携带凭据时依赖这里的白名单校验。
 */
const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://localhost:4173', 'http://localhost:5173', 'capacitor://localhost', 'https://localhost'];

function allowedOrigins(): string[] {
    const fromEnv = (process.env.CORS_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const base = process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL.replace(/\/+$/, '')] : [];
    return [...new Set([...fromEnv, ...base, ...DEFAULT_ORIGINS])];
}

export default defineEventHandler((event) => {
    const origin = getRequestHeader(event, 'origin');
    const allowList = allowedOrigins();
    const allowAll = allowList.includes('*');

    if (origin && (allowAll || allowList.includes(origin))) {
        setResponseHeaders(event, {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
            // 移动端需要读取 bearer 插件回传的 set-auth-token 与对话 id
            'Access-Control-Expose-Headers': 'set-auth-token, x-conversation-id',
            Vary: 'Origin',
        });
    }

    if (getMethod(event) === 'OPTIONS') {
        setResponseStatus(event, 204);
        return '';
    }
});
