import { getToolMetrics, TOOL_OUTPUT_MAX_BYTES, TOOL_TIMEOUT_MS } from '../../agent/tool-registry';
import { requireMethod } from '../../utils/method';

/**
 * 工具注册表的进程内指标（P1-5）。
 *
 * 只读、无副作用；跨进程不聚合，重启即清零。用于本机排查「哪个工具在超时/被截断」，
 * 不承担持久化监控职责。
 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    return {
        timeoutMs: TOOL_TIMEOUT_MS,
        maxOutputBytes: TOOL_OUTPUT_MAX_BYTES,
        tools: getToolMetrics(),
    };
});
