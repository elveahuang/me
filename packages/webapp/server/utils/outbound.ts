import { lookup } from 'node:dns/promises';
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
