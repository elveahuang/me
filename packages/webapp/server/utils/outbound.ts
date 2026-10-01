import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
// 显式引入 h3 的 createError，而不是依赖 Nitro 自动导入：
// 这样该工具函数在脚本 / 单测等非 Nitro 运行时里也能直接复用。
import { createError } from 'h3';

/**
 * 出站地址安全校验（防 SSRF）。
 *
 * 后台配置的 HTTP 工具由模型自主触发执行，若允许任意地址，
 * 模型即可把请求打到内网服务、云元数据端点（169.254.169.254）等敏感目标。
 * 默认拒绝私网/回环/链路本地地址，需要访问内网自建服务时可显式设置
 * `ALLOW_PRIVATE_OUTBOUND=true` 关闭该校验。
 */

function isPrivateIpv4(ip: string): boolean {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local / 云元数据
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
}

function isPrivateIpv6(ip: string): boolean {
    const value = ip.toLowerCase();
    if (value === '::' || value === '::1') return true;
    if (value.startsWith('fe80')) return true; // link-local
    if (value.startsWith('fc') || value.startsWith('fd')) return true; // unique local
    // IPv4-mapped ::ffff:a.b.c.d
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
    if (mapped) return isPrivateIpv4(mapped[1]!);
    return false;
}

export function isPrivateAddress(ip: string): boolean {
    const version = isIP(ip);
    if (version === 4) return isPrivateIpv4(ip);
    if (version === 6) return isPrivateIpv6(ip);
    return false;
}

/**
 * 校验管理员配置的出站基址（模型供应商 baseUrl、MCP url）是否为合法 http/https 绝对地址。
 * 只做协议/可解析性校验，不做私网拦截：自建模型网关与内网 MCP 是合法部署形态，
 * 运行期出站是否放行由 assertSafeOutboundUrl（受 ALLOW_PRIVATE_OUTBOUND 控制）负责。
 * 返回去掉末尾斜杠的规范化地址。
 */
export function assertAbsoluteHttpUrl(label: string, raw: unknown): string {
    const value = String(raw ?? '').trim();
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw createError({ statusCode: 400, statusMessage: `${label}必须是合法的 http/https 地址` });
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw createError({ statusCode: 400, statusMessage: `${label}仅允许 http/https 协议` });
    }
    return value.replace(/\/+$/, '');
}

/** 用输入值填充 {{param}} 占位符（URL 与请求体模板共用） */
export function fillUrlTemplate(template: string, values: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
        const value = values[name];
        if (value === undefined) return '';
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
    });
}

/**
 * 填充 URL 模板并锁定管理员配置的原点（scheme + host + port）。
 * 参数值由模型自主生成，`@`、`#` 等内容一旦被替换进 authority 段就能改写真实主机
 * （如 `evil.com/#` 把模板主机变成用户名），SSRF 校验形同虚设。
 * 这里把占位符替换成中性标记后先解析出「模板原点」，填充结果的 origin 与之不符即拒绝——
 * 因此参数只能出现在路径/查询段，不允许模板主机本身由参数决定。
 */
export function fillAndPinOrigin(template: string, values: Record<string, unknown>): string {
    let templateOrigin: string;
    try {
        // 未知键与空值在 URL 位置填 'x'（保持标签非空）；若是 `scheme://{{h}}` 形式则解析失败，再退填 '1'
        const substituted = (filler: string) => template.replace(/\{\{\w+\}\}/g, filler);
        let probe: URL;
        try {
            probe = new URL(substituted('x'));
        } catch {
            probe = new URL(substituted('1'));
        }
        if (!['http:', 'https:'].includes(probe.protocol)) throw new Error('bad protocol');
        templateOrigin = probe.origin;
    } catch {
        throw createError({ statusCode: 400, statusMessage: '工具 URL 模板不是合法的 http/https 原点，请检查管理员配置' });
    }
    const filled = fillUrlTemplate(template, values);
    let url: URL;
    try {
        url = new URL(filled);
    } catch {
        throw createError({ statusCode: 400, statusMessage: `参数填充后工具 URL 不再是合法地址：${filled.slice(0, 80)}` });
    }
    if (url.origin !== templateOrigin) {
        throw createError({ statusCode: 400, statusMessage: '参数不允许改变工具请求的主机与协议（origin 已锁定）' });
    }
    return filled;
}

/** 校验 URL 协议与解析后的目标 IP；不合法时抛 400 */
export async function assertSafeOutboundUrl(raw: string): Promise<void> {
    if (process.env.ALLOW_PRIVATE_OUTBOUND === 'true') return;

    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw createError({ statusCode: 400, statusMessage: `目标地址不是合法 URL：${raw.slice(0, 80)}` });
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw createError({ statusCode: 400, statusMessage: '目标地址仅允许 http/https 协议' });
    }

    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
        throw createError({ statusCode: 400, statusMessage: `出于安全考虑，HTTP 工具禁止访问内网地址（${host}）` });
    }

    let addresses: string[];
    if (isIP(host)) {
        addresses = [host];
    } else {
        try {
            addresses = (await lookup(host, { all: true })).map((r) => r.address);
        } catch {
            throw createError({ statusCode: 400, statusMessage: `无法解析目标主机：${host}` });
        }
    }

    if (addresses.some((ip) => isPrivateAddress(ip))) {
        throw createError({ statusCode: 400, statusMessage: `出于安全考虑，HTTP 工具禁止访问内网地址（${host}）` });
    }
}

/**
 * http/https 的自定义解析回调：socket 实际连接的那一刻才做校验，私网结果直接报错。
 * assertSafeOutboundUrl 的 DNS 预检与 fetch 自带解析之间存在 TOCTOU 窗口
 * （两次解析可以返回不同 IP，即 DNS rebinding），经 lookup 建立的连接必须由本函数把关才算闭合。
 */
function guardedLookup(allowPrivate: boolean): https.RequestOptions['lookup'] {
    return (hostname, options, callback) => {
        // Node 24 起 dns.promises.lookup 即使传 callback 也只回 promise，必须用 then/catch 衔接
        const promise = (lookup as any)(hostname, options) as Promise<unknown>;
        promise.then(
            (value) => {
                if (allowPrivate) return callback(null, value as any, 0);
                const addresses: string[] = Array.isArray(value) ? (value as any[]).map((r) => r.address) : [String(value ?? '')];
                if (addresses.some((ip) => isPrivateAddress(ip))) {
                    return callback(Object.assign(new Error(`出于安全考虑，HTTP 工具禁止访问内网地址（${hostname}）`), { code: 'ECONNREFUSED' }), '', 0);
                }
                return callback(null, value as any, 0);
            },
            (error: unknown) => callback(error as Error, '', 0),
        );
    };
}

export interface OutboundFetchInit {
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs: number;
}

export interface OutboundFetchResult {
    status: number;
    location: string;
    text: string;
}

/**
 * 有上限地读完一个 fetch 响应的正文，返回 { text, truncated }。
 *
 * 与 safeOutboundFetch 的截断读取同一不变量：`res.text()` / `res.json()` 会先把**整个**
 * 响应体缓冲进内存，之后再 slice 只是丢弃副本——baseUrl 打错到一个大文件、或供应商端点
 * 被换成持续推送的流，一次「连通测试」就能把 Nitro 进程内存吃爆。
 * 超过 maxBytes 即 cancel 底层流，让上游别再继续推。
 */
export async function readCappedResponseText(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
    if (!res.body) return { text: (await res.text()).slice(0, maxBytes), truncated: false };

    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done || !value) break;
            if (size + value.byteLength > maxBytes) {
                chunks.push(Buffer.from(value.subarray(0, Math.max(0, maxBytes - size))));
                truncated = true;
                break;
            }
            chunks.push(Buffer.from(value));
            size += value.byteLength;
        }
    } finally {
        // 超限时取消读取：不 cancel 的话连接仍在把剩余字节下载完，只是我们不存
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
    return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}

/**
 * 出站 HTTP 请求（替代裸 fetch 的 SSRF 安全版）：先做地址预检，再以 guardedLookup 建连接。
 * 不自动跟随重定向（与 fetch redirect:'manual' 同语义），调用方拿 3xx + location 自行处理。
 */
export async function safeOutboundFetch(raw: string, init: OutboundFetchInit): Promise<OutboundFetchResult> {
    await assertSafeOutboundUrl(raw);
    const url = new URL(raw);
    const transport = url.protocol === 'https:' ? https : http;
    const allowPrivate = process.env.ALLOW_PRIVATE_OUTBOUND === 'true';
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate && isIP(host) && isPrivateAddress(host)) {
        throw createError({ statusCode: 400, statusMessage: `出于安全考虑，HTTP 工具禁止访问内网地址（${host}）` });
    }

    return new Promise((resolve, reject) => {
        const req = transport.request(url, { method: init.method, headers: init.headers, lookup: guardedLookup(allowPrivate) }, (res) => {
            const chunks: Buffer[] = [];
            let size = 0;
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                resolve({
                    status: res.statusCode ?? 0,
                    location: res.headers.location ?? '',
                    text: Buffer.concat(chunks).toString('utf8').slice(0, 4000),
                });
            };
            res.on('data', (chunk: Buffer) => {
                size += chunk.length;
                // 与 fetch 路径同样截到 4000 字符，多余字节直接丢弃不再积累
                if (size <= 64_000) {
                    chunks.push(chunk);
                    return;
                }
                // 超出读取上限即断开：原先只是不再 push，但会继续把整个响应体下载完。
                res.destroy();
                finish();
            });
            res.on('end', finish);
            res.on('error', (error) => {
                // IncomingMessage 的 'error' 必须有监听器：连接被重置/响应体被截断时它照样抛错，
                // 未监听的 'error' 事件即 uncaughtException，plugins/error-guard 会 process.exit(1)——
                // 一个不稳定的第三方接口就能打死整个服务进程。
                if (settled) return;
                settled = true;
                req.destroy(error);
                reject(error);
            });
        });
        req.setTimeout(init.timeoutMs, () => {
            req.destroy(Object.assign(new Error('出站请求超时'), { code: 'ETIMEDOUT' }));
        });
        req.on('error', reject);
        if (init.body) req.write(init.body);
        req.end();
    });
}
