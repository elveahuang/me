/**
 * CORS 处理（此前 CORS_ORIGINS 只是一份没人读取的死配置）。
 *
 * 允许来源 = CORS_ORIGINS（逗号分隔） + BETTER_AUTH_URL + 本地开发 / 原生壳默认地址。
 * 浏览器端仍受 Cookie 的 SameSite=Lax 约束，跨域请求需携带凭据时依赖这里的白名单校验。
 *
 * 凭据安全：本平台接口一律依赖 Cookie / Bearer 凭据，因此只按显式白名单回显 Origin。
 * `*` 与 Access-Control-Allow-Credentials:true 不能共存——回显任意来源 + 允许携带凭据，
 * 等于让任意网站带着用户会话跨域读取响应，所以配置了 `*` 也不放行未列出的来源。
 */
const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://localhost:4173', 'http://localhost:5173', 'capacitor://localhost', 'https://localhost'];

let wildcardWarned = false;

function resolveOrigins(): { allowList: string[]; wildcardConfigured: boolean } {
    const fromEnv = (process.env.CORS_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const wildcardConfigured = fromEnv.includes('*');
    const base = process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL.replace(/\/+$/, '')] : [];
    const allowList = [...new Set([...fromEnv.filter((o) => o !== '*'), ...base, ...DEFAULT_ORIGINS])];
    return { allowList, wildcardConfigured };
}

export default defineEventHandler((event) => {
    const origin = getRequestHeader(event, 'origin');
    const { allowList, wildcardConfigured } = resolveOrigins();
    if (wildcardConfigured && !wildcardWarned) {
        wildcardWarned = true;
        console.warn('[cors] CORS_ORIGINS 含 `*`；因接口需携带凭据，通配符已被忽略，请改为显式白名单');
    }

    if (origin && allowList.includes(origin)) {
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
