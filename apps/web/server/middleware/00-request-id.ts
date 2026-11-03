import { REQUEST_ID_HEADER, newRequestId, normalizeRequestId } from '../utils/request-id';

/**
 * 给每个请求分配/透传关联 id，并回写响应头。
 *
 * 文件名以 `00-` 开头是为了排在 `local-guard` 之前：来源校验失败的 403 也要带上 id，
 * 否则最需要排障的那类拒绝反而是唯一没有关联 id 的响应。
 */
export default defineEventHandler((event) => {
    const incoming = normalizeRequestId(getRequestHeader(event, REQUEST_ID_HEADER));
    const requestId = incoming ?? newRequestId();
    event.context.requestId = requestId;
    setResponseHeader(event, REQUEST_ID_HEADER, requestId);
});
