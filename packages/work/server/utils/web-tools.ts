import { tool, type ToolSet } from 'ai';
import { createError } from 'h3';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as zod from 'zod';

/**
 * 只读网页工具（P2-6 的一部分）。
 *
 * 默认关闭，`WEB_TOOL_ENABLED=1` 才注入。只允许 http/https，解析域名后拒绝回环/私网/链路本地地址，
 * 重定向逐跳复核，避免模型用 URL 把本机服务当成“外网页面”读取。正文去脚本/样式/标签后截断。
 */

const MAX_BYTES = 2_000_000;
const MAX_TEXT = 50_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;

export const WEB_TOOL_SUMMARY = '- web_fetch：读取一个公开网页的正文（默认关闭；需 WEB_TOOL_ENABLED=1，拒绝私网/回环地址）';
export const WEB_SEARCH_TOOL_SUMMARY = '- web_search：用配置的搜索供应商检索公开网页，返回标题/URL/摘要（需 TAVILY_API_KEY 或 BRAVE_SEARCH_API_KEY）';

export type WebSearchProvider = 'tavily' | 'brave';

export function isWebEnabled(): boolean {
    const value = (process.env.WEB_TOOL_ENABLED || '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
}

/** 有供应商凭据才注入 web_search，避免提示词里列一个必然失败的工具。 */
export function resolveWebSearchProvider(): { provider: WebSearchProvider; key: string } | null {
    const preferred = (process.env.WEB_SEARCH_PROVIDER || '').trim().toLowerCase();
    const tavily = (process.env.TAVILY_API_KEY || '').trim();
    const brave = (process.env.BRAVE_SEARCH_API_KEY || '').trim();
    if (preferred === 'tavily' && tavily) return { provider: 'tavily', key: tavily };
    if (preferred === 'brave' && brave) return { provider: 'brave', key: brave };
    if (tavily) return { provider: 'tavily', key: tavily };
    if (brave) return { provider: 'brave', key: brave };
    return null;
}

export function hasWebSearch(): boolean {
    return isWebEnabled() && Boolean(resolveWebSearchProvider());
}

function isPrivateIp(address: string): boolean {
    if (isIP(address) === 4) {
        const parts = address.split('.').map(Number);
        const a = parts[0] ?? -1;
        const b = parts[1] ?? -1;
        return (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 100 && b >= 64 && b <= 127) ||
            a >= 224
        );
    }
    if (isIP(address) === 6) {
        const lower = address.toLowerCase();
        return (
            lower === '::1' ||
            lower === '::' ||
            lower.startsWith('fc') ||
            lower.startsWith('fd') ||
            lower.startsWith('fe8') ||
            lower.startsWith('fe9') ||
            lower.startsWith('fea') ||
            lower.startsWith('feb') ||
            lower.startsWith('::ffff:127.') ||
            lower.startsWith('::ffff:10.') ||
            lower.startsWith('::ffff:192.168.')
        );
    }
    return true;
}

async function assertPublicUrl(raw: string): Promise<URL> {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw createError({ statusCode: 400, statusMessage: 'url 不是合法地址' });
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw createError({ statusCode: 400, statusMessage: '只支持 http/https' });
    if (url.username || url.password) throw createError({ statusCode: 400, statusMessage: 'url 不能包含用户名或密码' });
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
        throw createError({ statusCode: 403, statusMessage: '不允许访问本机或内网地址' });
    }
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (!addresses.length) throw createError({ statusCode: 400, statusMessage: '域名无法解析' });
    if (addresses.some((entry) => isPrivateIp(entry.address))) throw createError({ statusCode: 403, statusMessage: '不允许访问本机或内网地址' });
    return url;
}

function stripHtml(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

export async function fetchWebPage(rawUrl: unknown): Promise<{ url: string; contentType: string; truncated: boolean; text: string }> {
    if (!isWebEnabled()) throw createError({ statusCode: 403, statusMessage: '网页工具未开启，请先在 .env 设置 WEB_TOOL_ENABLED=1' });
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) throw createError({ statusCode: 400, statusMessage: 'url 不能为空' });
    let url = await assertPublicUrl(rawUrl.trim());

    let response: Response | null = null;
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
        response = await fetch(url, {
            redirect: 'manual',
            headers: { 'user-agent': 'WorkbenchBot/1.0 (+local)', accept: 'text/html,application/xhtml+xml,text/plain' },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location) break;
            url = await assertPublicUrl(new URL(location, url).toString());
            continue;
        }
        break;
    }
    if (!response) throw createError({ statusCode: 502, statusMessage: '网页请求失败' });
    if (!response.ok) throw createError({ statusCode: 502, statusMessage: `网页返回 ${response.status}` });
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/|html|json|xml/i.test(contentType)) throw createError({ statusCode: 415, statusMessage: '只支持文本类网页' });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: '网页超过 2MB 上限' });
    const ray = buffer.toString('utf8');
    const text = /html/i.test(contentType) ? stripHtml(ray) : ray;
    return { url: url.toString(), contentType, truncated: text.length > MAX_TEXT, text: text.slice(0, MAX_TEXT) };
}

export interface WebSearchResult {
    title: string;
    url: string;
    snippet: string;
}

export interface WebSearchResponse {
    provider: WebSearchProvider;
    query: string;
    results: WebSearchResult[];
}

function clip(value: unknown, max: number): string {
    return typeof value === 'string'
        ? value
              .replace(/\u0000/g, '')
              .trim()
              .slice(0, max)
        : '';
}

/**
 * 搜索走固定供应商端点，但仍复用 `assertPublicUrl`：端点可被企业代理/环境变量改写时，
 * 不让一个指向 127.0.0.1 的 URL 把本机服务当成搜索结果源。
 */
export async function searchWeb(rawQuery: unknown, rawLimit: unknown = 5): Promise<WebSearchResponse> {
    if (!isWebEnabled()) throw createError({ statusCode: 403, statusMessage: '网页工具未开启，请先在 .env 设置 WEB_TOOL_ENABLED=1' });
    const query =
        typeof rawQuery === 'string'
            ? rawQuery
                  .replace(/\u0000/g, '')
                  .trim()
                  .slice(0, 400)
            : '';
    if (!query) throw createError({ statusCode: 400, statusMessage: 'query 不能为空' });
    const configured = resolveWebSearchProvider();
    if (!configured) throw createError({ statusCode: 501, statusMessage: '没有配置搜索供应商：请设置 TAVILY_API_KEY 或 BRAVE_SEARCH_API_KEY' });
    const limit = Math.min(8, Math.max(1, Math.trunc(Number(rawLimit)) || 5));

    if (configured.provider === 'tavily') {
        const endpoint = await assertPublicUrl('https://api.tavily.com/search');
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ api_key: configured.key, query, max_results: limit, search_depth: 'basic', include_answer: false }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) throw createError({ statusCode: 502, statusMessage: `搜索服务返回 ${response.status}` });
        const raw = await response.text();
        if (raw.length > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: '搜索结果超过 2MB 上限' });
        let parsed: { results?: Array<{ title?: unknown; url?: unknown; content?: unknown }> };
        try {
            parsed = JSON.parse(raw) as typeof parsed;
        } catch {
            throw createError({ statusCode: 502, statusMessage: '搜索服务返回了无法解析的 JSON' });
        }
        const results = (parsed.results ?? [])
            .map((entry) => ({ title: clip(entry.title, 300), url: clip(entry.url, 2000), snippet: clip(entry.content, 1000) }))
            .filter((entry) => entry.url.startsWith('http'))
            .slice(0, limit);
        return { provider: 'tavily', query, results };
    }

    const endpoint = await assertPublicUrl(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`);
    const response = await fetch(endpoint, {
        headers: { accept: 'application/json', 'x-subscription-token': configured.key },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw createError({ statusCode: 502, statusMessage: `搜索服务返回 ${response.status}` });
    const raw = await response.text();
    if (raw.length > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: '搜索结果超过 2MB 上限' });
    let parsed: { web?: { results?: Array<{ title?: unknown; url?: unknown; description?: unknown }> } };
    try {
        parsed = JSON.parse(raw) as typeof parsed;
    } catch {
        throw createError({ statusCode: 502, statusMessage: '搜索服务返回了无法解析的 JSON' });
    }
    const results = (parsed.web?.results ?? [])
        .map((entry) => ({ title: clip(entry.title, 300), url: clip(entry.url, 2000), snippet: clip(entry.description, 1000) }))
        .filter((entry) => entry.url.startsWith('http'))
        .slice(0, limit);
    return { provider: 'brave', query, results };
}

export function buildWebTools(): ToolSet {
    if (!isWebEnabled()) return {} as ToolSet;
    const set: Record<string, unknown> = {
        web_fetch: tool({
            description: '读取一个公开网页的正文（去导航/脚本后截断到 5 万字符）。拒绝 localhost、私网与文件协议。',
            inputSchema: zod.object({ url: zod.string().describe('要读取的 http(s) URL') }),
            execute: async (input) => {
                try {
                    return await fetchWebPage(input.url);
                } catch (error) {
                    const record = error as { statusMessage?: string; message?: string };
                    return { error: { code: 'WEB_FETCH_FAILED', message: record?.statusMessage || '网页读取失败' } };
                }
            },
        }),
    };
    if (resolveWebSearchProvider()) {
        set.web_search = tool({
            description: '检索公开网页，返回标题、URL 与摘要；需要引用来源时用它，随后可用 web_fetch 读全文。',
            inputSchema: zod.object({
                query: zod.string().min(1).max(400).describe('搜索词'),
                maxResults: zod.number().int().min(1).max(8).optional().describe('返回条数，默认 5'),
            }),
            execute: async (input) => {
                try {
                    return await searchWeb(input.query, input.maxResults ?? 5);
                } catch (error) {
                    const record = error as { statusMessage?: string; message?: string };
                    return { error: { code: 'WEB_SEARCH_FAILED', message: record?.statusMessage || '搜索失败' } };
                }
            },
        });
    }
    return set as ToolSet;
}
