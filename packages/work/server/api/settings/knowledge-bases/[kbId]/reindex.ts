import { gateExpensiveCalls } from '../../../../utils/expensive-gate';
import { getKbReindexJob, startKbReindex } from '../../../../utils/kb-reindex';
import { requireMethod } from '../../../../utils/method';
import { ADMIN_BODY_LIMIT_BYTES, capBody } from '../../../../utils/request-body';
import { routeId } from '../../../../utils/route-id';

/**
 * 知识库向量重建（P3-3）。
 *
 * `POST` 只负责发起，立即回 202 + 任务快照；实际嵌入在进程内后台跑。
 * `GET` 返回当前/最近一次任务快照，页面轮询它显示进度；没有任务时回 `{ job: null }`。
 *
 * 目录名使用 [kbId]（与同级 [id].ts 区分），避免同段 param 名冲突导致路由匹配异常。
 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET', 'POST']);
    const kbId = routeId(event, 'kbId', '知识库');

    if (event.method === 'GET') {
        return { job: getKbReindexJob(kbId) };
    }

    await capBody(event, ADMIN_BODY_LIMIT_BYTES);
    // 整库重建是最贵的一条入口：一批 16 块配一轮 /embeddings 外呼，预算内可以连跑成百上千轮。
    // 阈值 5/分只挡循环与重复提交；真正防重复执行的是任务表里的 running 判断。
    await gateExpensiveCalls(`kb-reindex:${kbId}`, '索引重建', 5);

    const { started, job } = await startKbReindex(kbId);
    if (!started) {
        throw createError({ statusCode: 409, statusMessage: '该知识库正在重建索引，请等待当前任务结束', data: { job } });
    }
    setResponseStatus(event, 202);
    return { started: true, job };
});
