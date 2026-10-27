import { eq } from 'drizzle-orm';
import { createError } from 'h3';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { skills } from '../db/schema';
import { db } from './db';

/**
 * 文件系统技能（P2-5）。
 *
 * 从一个或多个目录里读 `SKILL.md` / `*.md`：YAML 风格的简单 frontmatter 提供 name/description，
 * 其余正文作为 instructions。导入是**幂等 upsert**（id 由绝对路径哈希得到），不删除数据库里
 * 手工建的技能，也不碰 enabled——文件改名会生成新行，旧的留给用户自己处理。
 *
 * 没有做 DSH 式渐进披露：绑定技能仍由 system-prompt 注入全文；这里的价值是把「仓库里已有的
 * SKILL.md」接进同一张表与同一套绑定 UI。
 */

const MAX_FILES = 200;
const MAX_FILE_BYTES = 200_000;
const SKIP_DIRS = new Set(['node_modules', '.git', '.nuxt', '.output', 'dist']);

export interface ParsedSkillFile {
    name: string;
    description: string;
    instructions: string;
}

export interface SkillSyncResult {
    scanned: number;
    created: number;
    updated: number;
    skipped: number;
    files: string[];
}

export function parseSkillMarkdown(raw: string, fallbackName: string): ParsedSkillFile {
    const text = raw.replace(/\r\n/g, '\n');
    let name = fallbackName;
    let description = '';
    let body = text;

    if (text.startsWith('---\n')) {
        const end = text.indexOf('\n---', 4);
        if (end !== -1) {
            const header = text.slice(4, end);
            const bodyStart = text.indexOf('\n', end + 4);
            body = bodyStart === -1 ? '' : text.slice(bodyStart + 1).trimStart();
            for (const line of header.split('\n')) {
                const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
                if (!match) continue;
                const key = match[1]?.toLowerCase();
                const value = (match[2] || '').replace(/^['"]|['"]$/g, '').trim();
                if (key === 'name' && value) name = value;
                if (key === 'description') description = value;
            }
        }
    }

    if (!description) {
        const first = body
            .split('\n')
            .map((line) => line.replace(/^#+\s*/, '').trim())
            .find((line) => line.length > 0);
        description = (first || '').slice(0, 200);
    }
    return {
        name: name.trim().slice(0, 120) || fallbackName,
        description: description.trim().slice(0, 500),
        instructions: body.trim().slice(0, 100_000),
    };
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
    const found: string[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > 4 || found.length >= MAX_FILES) return;
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (found.length >= MAX_FILES) return;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name)) await walk(full, depth + 1);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
                found.push(full);
            }
        }
    };
    await walk(root, 0);
    return found;
}

export function skillRoots(): string[] {
    return (process.env.WORK_SKILL_ROOTS || '')
        .split(path.delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .filter((entry) => path.isAbsolute(entry));
}

export async function syncSkillsFromFiles(): Promise<SkillSyncResult> {
    const roots = skillRoots();
    if (!roots.length) throw createError({ statusCode: 400, statusMessage: '未配置 WORK_SKILL_ROOTS' });

    const result: SkillSyncResult = { scanned: 0, created: 0, updated: 0, skipped: 0, files: [] };
    for (const root of roots) {
        try {
            const info = await stat(root);
            if (!info.isDirectory()) continue;
        } catch {
            continue;
        }
        for (const file of await collectMarkdownFiles(root)) {
            const info = await stat(file).catch(() => null);
            if (!info || info.size > MAX_FILE_BYTES) {
                result.skipped += 1;
                continue;
            }
            const raw = await readFile(file, 'utf8').catch(() => null);
            if (raw === null) {
                result.skipped += 1;
                continue;
            }
            const parsed = parseSkillMarkdown(raw, path.basename(path.dirname(file)));
            const id = `file-${createHash('sha1').update(file.toLowerCase()).digest('hex').slice(0, 16)}`;
            const [existing] = await db.select().from(skills).where(eq(skills.id, id)).limit(1);
            if (!existing) {
                await db
                    .insert(skills)
                    .values({ id, ...parsed, enabled: true })
                    .onConflictDoNothing();
                result.created += 1;
            } else if (existing.name !== parsed.name || existing.description !== parsed.description || existing.instructions !== parsed.instructions) {
                await db
                    .update(skills)
                    .set({ ...parsed, updatedAt: new Date() })
                    .where(eq(skills.id, id));
                result.updated += 1;
            } else {
                result.skipped += 1;
            }
            result.scanned += 1;
            result.files.push(file);
        }
    }
    return result;
}
