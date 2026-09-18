import { and, eq, inArray } from 'drizzle-orm';
import { attachments } from '../../db/schema';
import { db } from '../../utils/db';
import { requireUser } from '../../utils/guard';
import { buildPublicUrl, resolveStorageConfig } from '../../utils/storage';

/**
 * 把已上传的附件解析成「可以放进聊天消息」的 file part。
 *
 * 为什么需要这一步（直接拿附件列表返回的 URL 拼 part 会踩两个坑）：
 * 1. 私有桶返回的是**预签名 URL**（默认 1 小时过期）。一旦写进 messages.parts 就成了历史数据，
 *    过期后图片/文件在会话里全部变成死链。
 * 2. 附件接口是 owner-only，别人的浏览器带不上 Bearer，跨用户展示同样失效。
 *
 * 因此这里按存储能力给出稳定引用：
 * - 配置了 publicBaseUrl（公开桶）：返回公开地址，既可展示也能被模型读取（视觉模型可用）
 * - 未配置（私有桶）：返回站内相对路径 `/api/attachments/{id}/raw`，由浏览器携带会话 cookie 读取；
 *   模型侧不会去抓这个地址，而是在 chat.post 里转成文字说明（见 toModelParts）
 */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const body = (await readBody(event).catch(() => null)) as { ids?: unknown } | null;
    const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map((v) => String(v)).filter(Boolean))].slice(0, 10) : [];
    if (!ids.length) {
        return { parts: [] };
    }

    const rows = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.userId, session.user.id), inArray(attachments.id, ids)));

    // 保持调用方传入的顺序，便于前端把 chip 与 part 对应起来
    const byId = new Map(rows.map((row) => [row.id, row]));

    let config: Awaited<ReturnType<typeof resolveStorageConfig>> | null = null;
    try {
        config = await resolveStorageConfig(null);
    } catch {
        config = null;
    }

    const parts = ids
        .map((id) => byId.get(id))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .map((row) => {
            const publicUrl = config ? buildPublicUrl(config, row.objectKey) : null;
            return {
                // AI SDK 的 FileUIPart：mediaType + url 是必需字段
                type: 'file' as const,
                mediaType: row.mimeType || 'application/octet-stream',
                filename: row.filename,
                // 公开桶给稳定公网地址；私有桶给站内路径（浏览器带 cookie 可读）
                url: publicUrl ?? `/api/attachments/${row.id}/raw`,
                // 供会话 UI 显示与删除时回溯，不参与模型输入
                attachmentId: row.id,
            };
        });

    return { parts };
});
