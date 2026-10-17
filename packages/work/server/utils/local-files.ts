import { createError } from 'h3';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * 本地文件只读工具的安全边界。
 *
 * work 没有账号体系，模型只能访问用户在 `WORK_FILE_ROOTS` 里显式列出的目录。
 * 所有路径先解析到真实路径再判断是否落在根目录内，符号链接不能把访问范围带出白名单。
 */

const MAX_LIST_ENTRIES = 300;
const MAX_LIST_DEPTH = 3;
const MAX_READ_BYTES = 120_000;
const MAX_SEARCH_FILES = 2_000;
const MAX_SEARCH_READ_BYTES = 4_000_000;
const MAX_SEARCH_RESULTS = 80;
const SKIP_DIRS = new Set(['node_modules', '.git', '.nuxt', '.output', 'dist', '.next', '.turbo', 'coverage', '__pycache__']);

export function parseLocalRoots(raw: string | undefined = process.env.WORK_FILE_ROOTS): string[] {
    if (!raw) return [];
    const roots = raw
        .split(';')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => resolve(value));
    return [...new Set(roots)];
}

export function isPathInside(root: string, target: string): boolean {
    const rel = relative(resolve(root), resolve(target));
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function fail(message: string, statusCode = 400): never {
    throw createError({ statusCode, statusMessage: message });
}

export async function resolveAllowedPath(raw: unknown, roots = parseLocalRoots()): Promise<string> {
    if (!roots.length) fail('没有配置本地文件目录，请先在 .env 设置 WORK_FILE_ROOTS');
    if (typeof raw !== 'string' || !raw.trim()) fail('path 必须是非空字符串');
    if (!isAbsolute(raw.trim())) fail('path 必须是绝对路径');
    let real: string;
    try {
        real = await realpath(raw.trim());
    } catch {
        fail('文件或目录不存在', 404);
    }
    const realRoots = await Promise.all(roots.map((root) => realpath(root).catch(() => resolve(root))));
    if (!realRoots.some((root) => isPathInside(root, real))) fail('路径不在 WORK_FILE_ROOTS 允许的目录内', 403);
    return real;
}

export interface LocalEntry {
    path: string;
    type: 'file' | 'directory';
    size?: number;
}

export async function listLocalFiles(rawPath: unknown, depthRaw: unknown = 1): Promise<LocalEntry[]> {
    const rootPath = await resolveAllowedPath(rawPath);
    const rootStat = await stat(rootPath);
    if (!rootStat.isDirectory()) fail('path 必须是目录');
    const depth = Math.min(Math.max(Math.floor(Number(depthRaw) || 1), 1), MAX_LIST_DEPTH);
    const out: LocalEntry[] = [];
    const queue: { path: string; depth: number }[] = [{ path: rootPath, depth: 0 }];

    while (queue.length && out.length < MAX_LIST_ENTRIES) {
        const current = queue.shift()!;
        let entries;
        try {
            entries = await readdir(current.path, { withFileTypes: true });
        } catch {
            continue;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            if (out.length >= MAX_LIST_ENTRIES) break;
            const full = join(current.path, entry.name);
            if (entry.isDirectory()) {
                if (SKIP_DIRS.has(entry.name)) continue;
                out.push({ path: full, type: 'directory' });
                if (current.depth + 1 < depth) queue.push({ path: full, depth: current.depth + 1 });
            } else if (entry.isFile()) {
                try {
                    const info = await stat(full);
                    out.push({ path: full, type: 'file', size: info.size });
                } catch {
                    // 文件在列目录与 stat 之间被删除：跳过，不影响其余结果。
                }
            }
        }
    }
    return out;
}

export async function readLocalFile(rawPath: unknown, maxBytesRaw: unknown = 60_000): Promise<string> {
    const file = await resolveAllowedPath(rawPath);
    const info = await stat(file);
    if (!info.isFile()) fail('path 必须是文件');
    const maxBytes = Math.min(Math.max(Math.floor(Number(maxBytesRaw) || 60_000), 1_000), MAX_READ_BYTES);
    if (info.size > MAX_READ_BYTES) fail(`文件超过 ${Math.round(MAX_READ_BYTES / 1000)}KB 上限`);
    const buffer = await readFile(file);
    if (buffer.includes(0)) fail('拒绝读取二进制文件');
    return buffer.subarray(0, maxBytes).toString('utf8');
}

export interface LocalSearchHit {
    path: string;
    match: 'name' | 'content';
    snippet: string;
}

export async function searchLocalFiles(queryRaw: unknown, rootRaw?: unknown, maxResultsRaw: unknown = 30): Promise<LocalSearchHit[]> {
    const query = typeof queryRaw === 'string' ? queryRaw.trim() : '';
    if (!query) fail('query 不能为空');
    if (query.length > 200) fail('query 最长 200 个字符');
    const roots: string[] = [];
    if (rootRaw) {
        const root = await resolveAllowedPath(rootRaw);
        const info = await stat(root);
        if (!info.isDirectory()) fail('root 必须是目录');
        roots.push(root);
    } else {
        roots.push(...parseLocalRoots());
    }
    if (!roots.length) fail('没有配置本地文件目录，请先在 .env 设置 WORK_FILE_ROOTS');
    const maxResults = Math.min(Math.max(Math.floor(Number(maxResultsRaw) || 30), 1), MAX_SEARCH_RESULTS);
    const lowerQuery = query.toLowerCase();
    const hits: LocalSearchHit[] = [];
    let scannedFiles = 0;
    let readBytes = 0;

    async function walk(dir: string, depth: number): Promise<void> {
        if (depth > 6 || scannedFiles >= MAX_SEARCH_FILES || readBytes >= MAX_SEARCH_READ_BYTES || hits.length >= maxResults) return;
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (scannedFiles >= MAX_SEARCH_FILES || readBytes >= MAX_SEARCH_READ_BYTES || hits.length >= maxResults) return;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name)) await walk(full, depth + 1);
                continue;
            }
            if (!entry.isFile()) continue;
            scannedFiles += 1;
            if (basename(full).toLowerCase().includes(lowerQuery)) {
                hits.push({ path: full, match: 'name', snippet: basename(full) });
                continue;
            }
            try {
                const info = await stat(full);
                if (info.size > MAX_READ_BYTES) continue;
                const buffer = await readFile(full);
                readBytes += buffer.length;
                if (buffer.includes(0)) continue;
                const text = buffer.toString('utf8');
                const index = text.toLowerCase().indexOf(lowerQuery);
                if (index >= 0) {
                    const start = Math.max(0, index - 80);
                    const snippet = text
                        .slice(start, start + 220)
                        .replace(/\s+/g, ' ')
                        .trim();
                    hits.push({ path: full, match: 'content', snippet });
                }
            } catch {
                // 单个文件读失败不影响搜索。
            }
        }
    }

    for (const root of roots) await walk(root, 0);
    return hits;
}
