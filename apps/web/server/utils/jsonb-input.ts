import { createError } from 'h3';

/**
 * 客户端可控的 JSON 树在进入 jsonb 列之前的两道闸门。
 *
 * jsonb 落库靠的是 `JSON.stringify(value)`，而 V8 的序列化器**是递归的**：
 * 实测 2 万层 `[` 让 `POST /api/settings/tools` 直接 500「Maximum call stack size exceeded」
 * （5000 层还能过，阈值在两者之间），`/api/chat` 的体积预检（同样一次 JSON.stringify）更早炸。
 * 一个 `[[[[…]]]]` 字符串就能把这两个接口变成 500 制造机，而请求体本身合法、体积也在闸门之内——
 * 体积上限管的是字节数，管不住形状。
 *
 * 深度用 64：工具 config、聊天 parts 的正常形状都是个位数层，没有任何真实客户端靠近过这个值；
 * 而上限以下的所有递归消费者（drizzle 的序列化、AI SDK 的克隆）栈深度也绰绰有余。
 */
export const JSONB_MAX_DEPTH = 64;

/** 迭代判断嵌套层数是否越界——用递归写这个检查会变成新的栈溢出点 */
export function exceedsJsonDepth(value: unknown, maxDepth: number): boolean {
    if (value === null || typeof value !== 'object') return false;
    const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 1 }];
    while (stack.length) {
        const { node, depth } = stack.pop()!;
        if (depth > maxDepth) return true;
        const children = Array.isArray(node) ? node : Object.values(node as Record<string, unknown>);
        for (const child of children) {
            if (child !== null && typeof child === 'object') stack.push({ node: child, depth: depth + 1 });
        }
    }
    return false;
}

/**
 * 管理端配置类 jsonb 的入口闸门：越界直接 400。
 * 报 400 而不是静默裁剪，是因为这类值是管理员手填/前端组装的配置，
 * 悄悄丢掉一半会让「配了却不生效」变成无法排查的现象。
 */
export function assertJsonDepth(label: string, value: unknown, maxDepth = JSONB_MAX_DEPTH): void {
    if (exceedsJsonDepth(value, maxDepth)) {
        throw createError({ statusCode: 400, statusMessage: `${label} 嵌套层级过深（最多 ${maxDepth} 层）` });
    }
}
