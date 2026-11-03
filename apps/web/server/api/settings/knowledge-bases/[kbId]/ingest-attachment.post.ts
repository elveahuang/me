import { createError } from 'h3';
import { gateExpensiveCalls } from '../../../../utils/expensive-gate';
import { ingestDocumentIntoKb, isTextLikeAttachment, MAX_KB_DOCUMENT_BYTES, readAttachmentBuffer } from '../../../../utils/kb-ingest';
import { requireMethod } from '../../../../utils/method';
import { readCappedJsonBody } from '../../../../utils/request-body';
import { routeId } from '../../../../utils/route-id';
import { normalizeWorkId } from '../../../../utils/work-input';

/**
 * `POST /api/settings/knowledge-bases/{kbId}/ingest-attachment`
 *
 * 将资料库（attachments）中已上传的文本/代码类附件一键读取、分块、向量化并入库到指定知识库，
 * 打通「聊天上传附件 / 资料库文件 → 知识库长期检索」的数据闭环。
 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['POST']);
    const kbId = routeId(event, 'kbId', '知识库');
    await gateExpensiveCalls(`kb-doc-write:${kbId}`, '文档入库', 30);

    const body = (await readCappedJsonBody<{ attachmentId?: unknown; title?: unknown }>(event)) ?? {};
    const attachmentId = normalizeWorkId(body.attachmentId, 'attachmentId');

    const { row, buffer } = await readAttachmentBuffer(attachmentId, MAX_KB_DOCUMENT_BYTES, false);
    if (!isTextLikeAttachment(row.filename, row.mimeType)) {
        throw createError({
            statusCode: 400,
            statusMessage: `暂不支持直接向量化此文件类型（${row.mimeType || '未知'}），请选择文本、Markdown、JSON、CSV 或代码文件`,
        });
    }

    const content = buffer.toString('utf-8');
    const customTitle = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : row.filename;
    return ingestDocumentIntoKb({
        kbId,
        title: customTitle,
        content,
    });
});
