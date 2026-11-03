import type { UIMessageChunk } from 'ai';

/**
 * 生成中的那一轮对话在内存里的副本，让「切页面 / 切会话 / 刷新」不再等于「打断生成」。
 *
 * 为什么需要它：ai@7 的 `Chat` 客户端在重连时会向 `GET /api/chat/{chatId}/stream` 要一条
 * **从头回放**的 UI-message 分片流（`resumeStreamIsReplay` 默认为 true，客户端在收到第一个
 * `message-start` 时清空在途状态再吃回放）。没有这份缓冲，刷新后的页面只能干等 `onFinish`
 * 落库的那条完整回复，中间几十秒界面什么都没有。
 *
 * 为什么缓冲必须有上限：正文分片是逐条字符串，长回答能到几百 KB；单用户本机应用同时最多
 * 跑几轮，所以封顶按「条数×字节」双限，越限就放弃缓冲（`overflow`）——此时重连拿到 204，
 * 客户端回源数据库历史，最坏表现退化成「看不到逐字流，但答案照常落库」。
 */

/** 单轮缓冲的上限：约等于一次长回答的量，再大就该让位给数据库回源而不是内存 */
const RUN_BUFFER_MAX_BYTES = 512 * 1024;
/**
 * 同时留存的轮次；超出的只淘汰**已完成**的那批。
 *
 * 必须与客户端 `useChatRuns.ts` 的 `INSTANCE_LIMIT` 成对看：客户端刻意留住 12 个 Chat 实例、
 * 且「正在生成的那一轮永远不淘汰」，服务端若按更小的上限连活轮次一起踢掉，被踢的那条就同时
 * 失去三样东西——`POST /api/chat/{id}/stop` 找不到目标（abort 送不到 `streamText`，模型照读完、
 * 照烧额度，而界面已经显示「已停止」）、`GET /api/chat/runs` 不再报它在途（侧栏「生成中」消失）、
 * `GET /api/chat/{id}/stream` 回 204（重连复位成 ready）。活轮次不需要这条闸门兜内存：
 * `RUN_STALE_MS` 会把没有正常收尾的顶掉，缓冲本身也有 `RUN_BUFFER_MAX_BYTES` 封顶。
 */
const RUN_MAX_COUNT = 12;
/** 结束后再留一会儿：给「刚跑完就切回来」的重连留回放窗口 */
const RUN_FINISHED_GRACE_MS = 60_000;
/** 流没有正常收尾（进程里抛错顶掉 flush）时的兜底：超过这个时长按已结束处理 */
const RUN_STALE_MS = 5 * 60_000;

export interface ChatRun {
    conversationId: string;
    /** 已产生的 SSE data 负载（每条是一个 UI message chunk 的 JSON） */
    lines: string[];
    bytes: number;
    /** 缓冲溢出后不再记录分片，重连只能回 204 */
    overflow: boolean;
    finished: boolean;
    startedAt: number;
    finishedAt: number | null;
    subscribers: Set<() => void>;
    /**
     * 交给 `streamText({ abortSignal })` 的那把闸。
     *
     * 必须有它：客户端 `Chat.stop()` 只撕掉浏览器那侧的 fetch，服务端仍会把模型读完并落库
     * （这是「切页面不打断生成」的实现基础，见本文件顶部）。所以「停止」这个用户意图
     * 只能靠这里主动 abort——否则点一次停止只是看不见，token 与 MCP 连接照烧不误。
     */
    controller: AbortController;
    aborted: boolean;
}

const runs = new Map<string, ChatRun>();

function closeRun(run: ChatRun) {
    if (run.finished) return;
    run.finished = true;
    run.finishedAt = Date.now();
    // 复制一份再通知：订阅者在回调里注销自己很常见，直接迭代 Set 会漏掉后半个
    for (const notify of [...run.subscribers]) notify();
}

/** 掐掉仍在跑的模型调用；已结束或未开闸的轮次是空操作 */
function abortRun(run: ChatRun) {
    if (run.aborted || run.finished) return;
    run.aborted = true;
    run.controller.abort();
}

/** 回收：超时的活轮次、超过宽限期的已完成轮次、总数超限时的老轮次 */
function sweep() {
    const now = Date.now();
    for (const [key, run] of runs) {
        if (!run.finished && now - run.startedAt > RUN_STALE_MS) closeRun(run);
        if (run.finished && run.finishedAt && now - run.finishedAt > RUN_FINISHED_GRACE_MS) runs.delete(key);
    }
    if (runs.size <= RUN_MAX_COUNT) return;
    // 只在「已结束」的那批里挑淘汰对象：活轮次被踢出表以后 `abortChatRun` 再也找不到它，
    // 「停止」按钮只撕得掉浏览器那侧的 fetch，模型继续读完、额度继续烧，界面却显示已经停了；
    // `GET /api/chat/runs` 也会漏报它，侧栏的「生成中」凭空消失。
    // 客户端（`useChatRuns.ts` 的 `INSTANCE_LIMIT = 12`）刻意留住每一个在跑的实例，
    // 所以这里宁可临时越过上限——活轮次自有 `RUN_STALE_MS` 收尾，不会无限堆积。
    const finishedFirst = [...runs.values()].filter((run) => run.finished).sort((a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt));
    for (const run of finishedFirst.slice(0, runs.size - RUN_MAX_COUNT)) runs.delete(run.conversationId);
}

export function beginChatRun(conversationId: string): ChatRun {
    sweep();
    // 同一段会话的上一轮若还挂着（客户端并发护栏被绕过、或刷新后另起一轮），先掐掉它的模型调用再收尾：
    // 两条回复都往这段历史里写，用户看到的是「新答复完了，上一轮的半截又冒出来」。
    const previous = runs.get(conversationId);
    if (previous) {
        abortRun(previous);
        closeRun(previous);
    }
    const run: ChatRun = {
        conversationId,
        lines: [],
        bytes: 0,
        overflow: false,
        finished: false,
        startedAt: Date.now(),
        finishedAt: null,
        subscribers: new Set(),
        controller: new AbortController(),
        aborted: false,
    };
    runs.set(conversationId, run);
    return run;
}

export function appendChatChunk(run: ChatRun, chunk: UIMessageChunk) {
    if (run.finished || run.overflow) return;
    let line: string;
    try {
        line = JSON.stringify(chunk);
    } catch {
        // 分片里出现循环引用之类不该有的形状：丢掉缓冲而不是打断这一轮
        return;
    }
    const nextBytes = run.bytes + line.length + 1;
    if (nextBytes > RUN_BUFFER_MAX_BYTES) {
        run.overflow = true;
        run.lines = [];
        run.bytes = 0;
        return;
    }
    run.lines.push(line);
    run.bytes = nextBytes;
    for (const notify of [...run.subscribers]) notify();
}

export function endChatRun(run: ChatRun) {
    closeRun(run);
}

/**
 * 取某段会话可回放的轮次。
 *
 * `finished && 已落库` 的那种仍然返回：刚跑完就切回页面的重连能立刻拿到回放，
 * 不必等下一次历史拉取才知道「原来已经答完了」。只有溢出的轮次回 `null`，
 * 调用方据此发 204，客户端走数据库回源。
 */
export function getChatRun(conversationId: string): ChatRun | null {
    sweep();
    const run = runs.get(conversationId);
    if (!run || run.overflow) return null;
    return run;
}

export function runningConversationIds(): string[] {
    sweep();
    return [...runs.values()].filter((run) => !run.finished).map((run) => run.conversationId);
}

/**
 * 订阅一条轮次的分片：先用游标追上已缓冲的部分，再收后续通知。
 *
 * 单线程 JS 里「注册订阅」与「首次追赶」之间不会插入新的分片，追赶期间也不会漏——
 * 每个订阅者自带 cursor，`appendChatChunk` 只负责「叫醒」订阅者，由它自己按游标取增量。
 */
export function subscribeChatRun(run: ChatRun, onLine: (line: string) => void, onEnd: () => void): () => void {
    let cursor = 0;
    let ended = false;
    const pump = () => {
        if (ended) return;
        while (cursor < run.lines.length) {
            const line = run.lines[cursor++];
            if (line !== undefined) onLine(line);
        }
        if (run.finished) {
            ended = true;
            onEnd();
        }
    };
    run.subscribers.add(pump);
    pump();
    return () => run.subscribers.delete(pump);
}

/** 把响应流接上一轮缓冲：分片原样透传，同时留一份给之后的重连。 */
export function tapChatRun(stream: ReadableStream<UIMessageChunk>, run: ChatRun): ReadableStream<UIMessageChunk> {
    return stream.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
            transform(chunk, controller) {
                appendChatChunk(run, chunk);
                controller.enqueue(chunk);
            },
            flush() {
                endChatRun(run);
            },
        }),
    );
}

/**
 * 重连侧的响应流：先把缓冲里的分片从头回放，再跟着活轮次续读，轮次收尾即关流。
 *
 * 回放的分片序列与原始 POST 响应逐条相同，所以客户端吃回放和吃第一次的真实流没有区别。
 */
export function createChatRunStream(run: ChatRun): ReadableStream<UIMessageChunk> {
    let unsubscribe: (() => void) | null = null;
    let closed = false;
    return new ReadableStream<UIMessageChunk>({
        start(controller) {
            unsubscribe = subscribeChatRun(
                run,
                (line) => {
                    let chunk: unknown;
                    try {
                        chunk = JSON.parse(line);
                    } catch {
                        // 缓冲里的每条都是自家 stringify 出来的，理论上到不了这里；真到了就跳过这条，别把整条流带崩
                        return;
                    }
                    controller.enqueue(chunk as UIMessageChunk);
                },
                () => {
                    if (closed) return;
                    closed = true;
                    controller.close();
                },
            );
        },
        // 客户端走掉只该让自己停止供给；生成侧的收尾由上面那个 tap 负责，与这条流无关
        cancel() {
            unsubscribe?.();
            unsubscribe = null;
        },
    });
}

/**
 * 用户点「停止」：掐掉仍在生成的那一条流。
 *
 * 返回 false 表示这一轮已经结束（或早被回收），没有可中断的东西——调用方据此回 200 而不是 404，
 * 因为「停止」在竞态下本来就该是幂等的：客户端按下按钮时那一轮可能刚好自己跑完了。
 */
export function abortChatRun(conversationId: string): boolean {
    const run = runs.get(conversationId);
    if (!run) return false;
    // 「这次真的掐掉了一条在跑的流」才算 stopped；重复点击与已经跑完的都回 false
    const didStop = !run.aborted && !run.finished;
    abortRun(run);
    return didStop;
}

/** 会话被删除时连带丢掉它的回放，并掐掉仍在跑的模型调用——没有会话可落库的回复不该继续烧 token */
export function dropChatRun(conversationId: string) {
    const run = runs.get(conversationId);
    if (!run) return;
    abortRun(run);
    closeRun(run);
    runs.delete(conversationId);
}
