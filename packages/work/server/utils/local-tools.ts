import { tool, type ToolSet } from 'ai';
import * as zod from 'zod';
import {
    editLocalFile,
    isLocalWriteEnabled,
    listLocalFiles,
    makeLocalDirectory,
    parseLocalRoots,
    readLocalFile,
    searchLocalFiles,
    writeLocalFile,
} from './local-files';

/**
 * 本地文件只读工具。
 *
 * 未配置 `WORK_FILE_ROOTS` 时不注入任何工具——模型不会看到不存在的本地能力，
 * 也不会因为一次误调用把路径边界暴露给供应商。所有路径校验在 `local-files.ts`。
 */

export const LOCAL_TOOL_SUMMARY = [
    '- local_roots：列出允许访问的本地目录（只读）',
    '- local_list_files：列出目录内容（只读，最多三层）',
    '- local_read_file：读取文本文件（只读，单文件上限 120KB）',
    '- local_search_files：按文件名或正文搜索本地目录（只读）',
].join('\n');

export const LOCAL_WRITE_TOOL_SUMMARY = [
    '- local_write_file：写入白名单内的文本文件（需 WORK_FILE_WRITE=1；支持 expectedVersion 防覆盖）',
    '- local_edit_file：按 oldText 精确替换一次并写回（需 WORK_FILE_WRITE=1）',
    '- local_mkdir：在白名单内创建目录（需 WORK_FILE_WRITE=1）',
].join('\n');

function explain(error: unknown): string {
    const record = error as { statusMessage?: string; message?: string };
    return `本地文件操作失败：${record?.statusMessage || '请检查路径与目录白名单'}`;
}

export function buildLocalFileTools(defaultRoot?: string | null): ToolSet {
    const roots = parseLocalRoots();
    if (!roots.length) return {} as ToolSet;
    const preferredRoot = defaultRoot?.trim() || undefined;
    const set: Record<string, unknown> = {};

    set.local_roots = tool({
        description: '列出本机工作台允许智能体只读访问的目录。读取文件前先调用它确认范围。',
        inputSchema: zod.object({}),
        execute: async () => {
            const header = preferredRoot ? `当前工作空间默认目录：${preferredRoot}\n` : '';
            return `${header}允许访问的本地目录（只读）：\n${roots.map((root) => `- ${root}`).join('\n')}`;
        },
    });

    set.local_list_files = tool({
        description: '列出白名单目录下的文件与子目录。path 必须是绝对路径（若当前空间已绑定默认目录，可省略 path）；depth 为 1–3，默认 1。',
        inputSchema: zod.object({
            path: zod.string().optional().describe('绝对路径，必须在 local_roots 返回的目录内；留空则使用当前空间绑定的默认目录'),
            depth: zod.number().optional().describe('递归深度 1–3，默认 1'),
        }),
        execute: async (input) => {
            try {
                const targetPath = input.path?.trim() || preferredRoot || roots[0]!;
                const entries = await listLocalFiles(targetPath, input.depth);
                if (!entries.length) return '目录为空或没有可列出的内容';
                return entries
                    .map(
                        (entry) =>
                            `${entry.type === 'directory' ? '[目录]' : '[文件]'} ${entry.path}${entry.size !== undefined ? ` (${entry.size} bytes)` : ''}`,
                    )
                    .join('\n');
            } catch (error) {
                return explain(error);
            }
        },
    });

    set.local_read_file = tool({
        description: '读取白名单目录内的文本文件。path 必须是绝对路径；maxBytes 默认 60000、最大 120000。二进制文件会拒绝。',
        inputSchema: zod.object({
            path: zod.string().describe('绝对路径，必须在 local_roots 返回的目录内'),
            maxBytes: zod.number().optional().describe('最多读取的字节数'),
        }),
        execute: async (input) => {
            try {
                return await readLocalFile(input.path, input.maxBytes);
            } catch (error) {
                return explain(error);
            }
        },
    });

    set.local_search_files = tool({
        description: '在本地白名单目录中按文件名或正文搜索。root 可选；不传则优先搜索当前工作空间目录或所有允许目录。',
        inputSchema: zod.object({
            query: zod.string().describe('搜索关键词，最长 200 字符'),
            root: zod.string().optional().describe('可选的绝对目录，必须在 local_roots 返回范围内'),
            maxResults: zod.number().optional().describe('最多返回 30 条，最大 80'),
        }),
        execute: async (input) => {
            try {
                const hits = await searchLocalFiles(input.query, input.root?.trim() || preferredRoot, input.maxResults);
                if (!hits.length) return '没有找到匹配文件';
                return hits.map((hit) => `[${hit.match === 'name' ? '文件名' : '正文'}] ${hit.path}\n  ${hit.snippet}`).join('\n');
            } catch (error) {
                return explain(error);
            }
        },
    });

    if (isLocalWriteEnabled()) {
        set.local_write_file = tool({
            description:
                '写入白名单目录内的文本文件。默认覆盖；带 expectedVersion 时若文件已被改动会返回 FS_STALE_VERSION。单文件上限 200KB，父目录必须已存在。',
            inputSchema: zod.object({
                path: zod.string().describe('绝对路径，必须在 local_roots 返回的目录内'),
                content: zod.string().describe('完整文件内容'),
                expectedVersion: zod.string().optional().describe('可选：上一次 local_write_file 返回的 version；不匹配则拒绝写入'),
            }),
            execute: async (input) => {
                try {
                    return await writeLocalFile(input.path, input.content, input.expectedVersion);
                } catch (error) {
                    return explain(error);
                }
            },
        });

        set.local_edit_file = tool({
            description: '在文件里把 oldText 精确替换成 newText（只替换第一次出现），适合小改动；大改动用 local_write_file。',
            inputSchema: zod.object({
                path: zod.string().describe('绝对路径，必须在 local_roots 返回的目录内'),
                oldText: zod.string().describe('要替换的原文，必须逐字匹配（含缩进）'),
                newText: zod.string().describe('替换后的文本'),
                expectedVersion: zod.string().optional().describe('可选：文件版本；不匹配则拒绝写入'),
            }),
            execute: async (input) => {
                try {
                    return await editLocalFile(input.path, input.oldText, input.newText, input.expectedVersion);
                } catch (error) {
                    return explain(error);
                }
            },
        });

        set.local_mkdir = tool({
            description: '在白名单目录内创建一个新目录；父目录必须已存在。',
            inputSchema: zod.object({
                path: zod.string().describe('要创建的绝对目录路径，必须位于 local_roots 范围内'),
            }),
            execute: async (input) => {
                try {
                    return await makeLocalDirectory(input.path);
                } catch (error) {
                    return explain(error);
                }
            },
        });
    }

    return set as ToolSet;
}
