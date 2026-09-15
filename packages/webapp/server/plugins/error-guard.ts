/**
 * 进程级异常兜底。
 *
 * SSE 流被客户端提前断开（curl | head、页面刷新）时会抛出 EPIPE/ECONNRESET，
 * 这类连接层异常可以安全忽略；其余未预期异常一律记录后退出，
 * 由 pm2 / docker / k8s 重启，避免进程带着未知状态继续对外服务。
 */
const IGNORABLE_CODES = new Set(['EPIPE', 'ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE', 'ERR_HTTP_HEADERS_SENT']);

function isIgnorable(err: unknown): boolean {
    const code = (err as { code?: string } | null)?.code;
    return typeof code === 'string' && IGNORABLE_CODES.has(code);
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
