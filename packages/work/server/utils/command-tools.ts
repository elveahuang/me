import { tool, type ToolSet } from 'ai';
import { createError } from 'h3';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import * as zod from 'zod';
import { resolveAllowedPath } from './local-files';

/**
 * 受控命令（P2-2）。
 *
 * 默认关闭，只有显式 `WORK_COMMAND_ENABLED=1` 才注入；cwd 必须落在 WORK_FILE_ROOTS 内。
 * 命令本身仍是 shell 字符串，所以审批是主要护栏：risk=execute 在任何模式下都需要人工放行。
 * 输出只保留头尾各 50KB，超时杀整棵进程树。
 */

const MAX_COMMAND_CHARS = 4_000;
const MAX_OUTPUT_BYTES = 100_000;
const MAX_TIMEOUT_SEC = 60;

export const COMMAND_TOOL_SUMMARY = '- run_command：在白名单目录内执行一条 shell 命令（默认关闭；需 WORK_COMMAND_ENABLED=1，且必须人工审批）';

export function isCommandEnabled(): boolean {
    const value = (process.env.WORK_COMMAND_ENABLED || '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
}

/** 只透传执行所需的基础环境，避免把 POSTGRES_URL / 模型密钥交给任意命令 */
export function safeEnv(): NodeJS.ProcessEnv {
    const allow = [
        'PATH',
        'HOME',
        'USERPROFILE',
        'TEMP',
        'TMP',
        'TMPDIR',
        'SystemRoot',
        'WINDIR',
        'ComSpec',
        'PATHEXT',
        'LANG',
        'LC_ALL',
        'TERM',
        'APPDATA',
        'LOCALAPPDATA',
        'PROGRAMFILES',
        'PROGRAMFILES(X86)',
        'PROGRAMDATA',
        'NUMBER_OF_PROCESSORS',
        'PROCESSOR_ARCHITECTURE',
    ];
    const env: NodeJS.ProcessEnv = {};
    for (const key of allow) {
        const value = process.env[key];
        if (value !== undefined) env[key] = value;
    }
    return env;
}

export function killTree(pid: number | undefined): void {
    if (!pid) return;
    if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => undefined);
        return;
    }
    try {
        process.kill(-pid, 'SIGKILL');
    } catch {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // 进程可能已经退出
        }
    }
}

function clipOutput(text: string): { text: string; truncated: boolean } {
    if (Buffer.byteLength(text, 'utf8') <= MAX_OUTPUT_BYTES) return { text, truncated: false };
    const half = Math.floor(MAX_OUTPUT_BYTES / 2);
    return { text: `${text.slice(0, half)}\n...[输出已截断]...\n${text.slice(-half)}`, truncated: true };
}

export interface CommandResult {
    command: string;
    cwd: string;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
    truncated: boolean;
}

export async function runControlledCommand(input: { command: unknown; cwd?: unknown; timeoutSec?: unknown }): Promise<CommandResult> {
    if (!isCommandEnabled()) throw createError({ statusCode: 403, statusMessage: '命令执行未开启，请先在 .env 设置 WORK_COMMAND_ENABLED=1' });
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    if (!command) throw createError({ statusCode: 400, statusMessage: 'command 不能为空' });
    if (command.length > MAX_COMMAND_CHARS) throw createError({ statusCode: 400, statusMessage: `command 最长 ${MAX_COMMAND_CHARS} 字符` });

    const cwdRaw = typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd.trim() : undefined;
    if (!cwdRaw) throw createError({ statusCode: 400, statusMessage: 'cwd 必填：必须是 WORK_FILE_ROOTS 内的绝对目录' });
    const cwd = await resolveAllowedPath(cwdRaw);
    if (!(await stat(cwd)).isDirectory()) throw createError({ statusCode: 400, statusMessage: 'cwd 必须是目录' });

    const timeoutSec = Math.min(Math.max(Math.floor(Number(input.timeoutSec) || 30), 1), MAX_TIMEOUT_SEC);
    const started = Date.now();

    return await new Promise<CommandResult>((resolve) => {
        const child = spawn(command, {
            cwd,
            shell: true,
            windowsHide: true,
            detached: process.platform !== 'win32',
            env: safeEnv(),
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;

        const finish = (exitCode: number | null, signal: string | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const out = clipOutput(stdout);
            const err = clipOutput(stderr);
            resolve({
                command,
                cwd,
                exitCode,
                signal,
                timedOut,
                durationMs: Date.now() - started,
                stdout: out.text,
                stderr: err.text,
                truncated: out.truncated || err.truncated,
            });
        };

        const timer = setTimeout(() => {
            timedOut = true;
            killTree(child.pid);
            // 某些平台 taskkill 不触发 close：再兜底一次
            setTimeout(() => finish(null, 'SIGKILL'), 1500).unref?.();
        }, timeoutSec * 1000);

        child.stdout?.on('data', (chunk: Buffer) => {
            if (stdout.length < MAX_OUTPUT_BYTES * 2) stdout += chunk.toString('utf8');
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            if (stderr.length < MAX_OUTPUT_BYTES * 2) stderr += chunk.toString('utf8');
        });
        child.on('error', (error) => {
            stderr += `\n[spawn error] ${error.message}`;
            finish(null, null);
        });
        child.on('close', (code, signal) => finish(code, signal));
    });
}

export function buildCommandTools(): ToolSet {
    if (!isCommandEnabled()) return {} as ToolSet;
    return {
        run_command: tool({
            description:
                '在 WORK_FILE_ROOTS 内的目录执行一条 shell 命令。默认禁止读取环境变量中的密钥；stdout/stderr 各保留头尾 50KB，超时杀进程树。cwd 必填。',
            inputSchema: zod.object({
                command: zod.string().describe('要执行的 shell 命令'),
                cwd: zod.string().describe('绝对目录，必须在 WORK_FILE_ROOTS 内'),
                timeoutSec: zod.number().optional().describe('超时秒数 1–60，默认 30'),
            }),
            execute: async (input) => {
                try {
                    return await runControlledCommand(input);
                } catch (error) {
                    const record = error as { statusMessage?: string; message?: string };
                    return { error: { code: 'COMMAND_FAILED', message: record?.statusMessage || '命令执行失败' } };
                }
            },
        }),
    } as ToolSet;
}
