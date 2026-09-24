/**
 * 进程级异常兜底。
 *
 * SSE 流被客户端提前断开（curl | head、页面刷新）时会抛出 EPIPE/ECONNRESET，
 * 这类连接层异常可以安全忽略；其余未预期异常一律记录后退出，
 * 由 pm2 / docker / k8s 重启，避免进程带着未知状态继续对外服务。
 */
const IGNORABLE_CODES = new Set([
    'EPIPE',
    'ECONNRESET',
    'ERR_STREAM_PREMATURE_CLOSE',
    'ERR_HTTP_HEADERS_SENT',
    // 自己设的超时（MCP 建连、出站 fetch）中断时，undici 挂的是 ABORT_ERR
    'ABORT_ERR',
    'ERR_STREAM_DESTROYED',
]);

/**
 * 只看顶层 code 不够：undici 会把连接层错误包成 `TypeError: fetch failed`，
 * 真实的 ECONNRESET/ABORT_ERR 挂在 `cause.code` 上。漏判的后果不是日志难读，
 * 是一次对端断连就 `process.exit(1)`，把同一进程里所有在途会话一起带走。
 */
function isIgnorable(err: unknown): boolean {
    let node: unknown = err;
    for (let depth = 0; node && depth < 5; depth += 1) {
        const code = (node as { code?: unknown }).code;
        if (typeof code === 'string' && IGNORABLE_CODES.has(code)) return true;
        node = (node as { cause?: unknown }).cause;
    }
    return false;
}

export default defineNitroPlugin(() => {
    process.on('uncaughtException', (err) => {
        if (isIgnorable(err)) {
            console.warn('[uncaughtException] 连接已断开，已忽略:', (err as { code?: string }).code);
            return;
        }
        console.error('[uncaughtException] 未预期异常，进程即将退出:', err);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
        if (isIgnorable(reason)) {
            console.warn('[unhandledRejection] 连接已断开，已忽略:', (reason as { code?: string }).code);
            return;
        }
        console.error('[unhandledRejection] 未处理的 Promise 拒绝，进程即将退出:', reason);
        process.exit(1);
    });
});
