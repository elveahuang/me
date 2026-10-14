/**
 * 「来源是不是本机」与「这个请求该不该拦」的判定，独立成 utils 是为了让它能被冒烟测试直接调用：
 * middleware 文件里全是 Nitro 自动导入（defineEventHandler/createError），tsx 直跑时根本构造不出来。
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** 需要核验来源的写方法；GET/HEAD 不拦（跨域读还要求响应头授权，而 work 从不回显 Origin） */
export const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 不带 Origin 的请求（SSR、定时任务、curl、原生 HTTP 客户端）按本机放行；
 * 带 Origin 时只认回环主机名。解析不了的 Origin 一律当外部来源。
 */
export function isLocalOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    try {
        return LOCAL_HOSTS.has(new URL(origin).hostname);
    } catch {
        return false;
    }
}

export function blocksWrite(method: string, origin: string | undefined): boolean {
    return WRITE_METHODS.has(method.toUpperCase()) && !isLocalOrigin(origin);
}
