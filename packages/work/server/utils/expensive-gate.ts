import { createError } from 'h3';
import { rateLimit } from './rate-limit';

/**
 * 给「一次请求就是一次外部调用」的管理端入口做按次闸门。
 *
 * 这类端点长什么样：providers/storage 的连通自检、MCP 的 tools/list、知识库的上传嵌入与整库重建、
 * 智能体的 AI 自动配置。它们共同的形状是——**没有循环保护**：每一次点击都真的建立一条对外连接，
 * 而一次外呼的预算从 15 秒（供应商自检）到几分钟（整库重建、非流式模型生成）不等。
 *
 * 为什么工作台这种「本机单主、没有账号」的应用仍然需要它：
 * 1. work 唯一的门是 Origin 核验（server/middleware/local-guard.ts），本机进程发出的请求一概放行，
 *    所以「同一个入口被反复触发」在服务端没有任何既有防线——写接口（笔记、排期、聊天、工具动作）都各自
 *    带了按次限流，唯独这批外部调用入口在早期是漏的，因为它们是 GET/POST 的「读」形态看着不像写。
 * 2. 这类请求的**成本不按次数计而按占用时长计**：一个卡在握手上的 MCP 服务器会让请求挂满 15 秒，
 *    重复点击就把 Nitro 的连接与内存一份份叠上去；providers 自检还会把上游 `/models` 的结果写回库，
 *    并发跑就是两次响应互相覆盖（W22 用本地 mock 实测过：服务端两次都照单全收）。
 * 3. 前端虽有在途判定（W22），但脚本、书签重放、多个标签页都绕过它。服务端这道是最后一层。
 *
 * 上限刻意留得宽松：这些操作都是人手点出来的，正常节奏远达不到阈值；阈值只为「循环/脚本/重复提交」
 * 而存在。调用方要按资源 id 建键（不同行各自计数，点 A 行不影响 B 行），并用 `label` 说明是哪类操作，
 * 让 429 的文案能直接读。
 *
 * 位置必须是 handler 开场——放在查库或解析之后，闸门就只是「晚一点拒绝」，
 * 那之前已经付掉的外呼/嵌入成本一分都没省下来。
 */
export async function gateExpensiveCalls(key: string, label: string, limit: number, windowMs = 60_000): Promise<void> {
    const limited = await rateLimit(key, limit, windowMs);
    if (!limited.ok) {
        throw createError({
            statusCode: 429,
            statusMessage: `${label}过于频繁（每分钟最多 ${limit} 次），请 ${limited.retryAfterSec} 秒后再试`,
        });
    }
}
