import { performance } from 'node:perf_hooks';
import type { DeriveInput } from '../server/agent/session/projection';
import { deriveMessages } from '../server/agent/session/projection';

/**
 * P4 负载基线（本机、开发构建）。
 *
 * 这不是压测工具，也不产生结论性的容量承诺：默认对 `127.0.0.1:3001` 串行请求 20 次，
 * 输出 p50/p95 供改动前后对比。要测生产构建请先 `pnpm --filter @repo/work build` 并
 * `node .output/server/index.mjs`，再用 `--base=http://127.0.0.1:3000` 指过去。
 *
 * 用法：`pnpm --filter @repo/work bench [-- --base=http://127.0.0.1:3001 --n=20]`
 */

const arg = (name: string, fallback: string): string => {
    const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE = arg('base', process.env.WORK_BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const N = Math.max(3, Math.min(200, Number(arg('n', '20')) || 20));

function percentile(sorted: number[], p: number): number {
    if (!sorted.length) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index]!;
}

async function bench(
    label: string,
    n: number,
    fn: (index: number) => Promise<void>,
): Promise<{ label: string; p50: number; p95: number; min: number; max: number }> {
    for (let i = 0; i < Math.min(3, n); i++) await fn(i);
    const samples: number[] = [];
    for (let i = 0; i < n; i++) {
        const started = performance.now();
        await fn(i);
        samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    return {
        label,
        p50: Number(percentile(samples, 50).toFixed(1)),
        p95: Number(percentile(samples, 95).toFixed(1)),
        min: Number(samples[0]!.toFixed(1)),
        max: Number(samples[samples.length - 1]!.toFixed(1)),
    };
}

async function json(path: string): Promise<void> {
    const response = await fetch(`${BASE}${path}`);
    if (!response.ok && response.status !== 204) throw new Error(`${path} -> ${response.status}`);
    await response.arrayBuffer();
}

/** 1000 条事件 = 250 轮完整的 user/run/tool/assistant 序列。 */
function projectionFixture(): DeriveInput[] {
    const events: DeriveInput[] = [];
    for (let turn = 0; turn < 250; turn++) {
        const turnId = `turn-${turn}`;
        const createdAt = new Date(2026, 0, 1, 0, 0, turn);
        events.push({
            seq: turn * 4 + 1,
            type: 'user/message',
            turnId,
            surfaceOp: null,
            data: { id: `u-${turn}`, parts: [{ type: 'text', text: `问题 ${turn}` }] },
            createdAt,
        });
        events.push({ seq: turn * 4 + 2, type: 'run/start', turnId, surfaceOp: null, data: { runId: `r-${turn}` }, createdAt });
        events.push({
            seq: turn * 4 + 3,
            type: 'tool/call',
            turnId,
            surfaceOp: null,
            data: { toolCallId: `t-${turn}`, toolName: 'work_today', input: {} },
            createdAt,
        });
        events.push({
            seq: turn * 4 + 4,
            type: 'assistant/message',
            turnId,
            surfaceOp: null,
            data: { id: `a-${turn}`, parts: [{ type: 'text', text: `回答 ${turn}` }] },
            createdAt,
        });
    }
    return events;
}

const projection = projectionFixture();
const rows = [
    await bench('projection 1000 events', Math.min(N, 20), async () => {
        if (deriveMessages(projection).length !== 500) throw new Error('projection fixture mismatch');
    }),
    await bench('GET /api/sessions?limit=20', N, async () => json('/api/sessions?limit=20')),
    await bench('GET /api/overview', N, async () => json('/api/overview')),
    await bench('GET /api/search?q=smoke', N, async () => json('/api/search?q=smoke')),
];

try {
    const sessions = await fetch(`${BASE}/api/sessions?limit=1`).then((res) => res.json() as Promise<{ sessions: { id: string }[] }>);
    const id = sessions.sessions[0]?.id;
    if (id) {
        rows.push(
            await bench('SSE follow first chunk', N, async () => {
                const controller = new AbortController();
                const response = await fetch(`${BASE}/api/sessions/${encodeURIComponent(id)}/follow`, {
                    headers: { 'last-event-id': '0' },
                    signal: controller.signal,
                });
                if (!response.ok) throw new Error(`follow -> ${response.status}`);
                const reader = response.body?.getReader();
                if (!reader) throw new Error('follow has no body');
                await reader.read();
                controller.abort();
            }),
        );
    }
} catch (error) {
    rows.push({ label: 'SSE follow first chunk (skipped)', p50: 0, p95: 0, min: 0, max: 0 });
    console.error(`[bench] SSE skipped: ${error instanceof Error ? error.message : String(error)}`);
}

console.log(`\nwork load baseline · ${BASE} · n=${N} · ${new Date().toISOString()}\n`);
console.log('| 场景 | p50 (ms) | p95 (ms) | min | max |');
console.log('| --- | ---: | ---: | ---: | ---: |');
for (const row of rows) console.log(`| ${row.label} | ${row.p50} | ${row.p95} | ${row.min} | ${row.max} |`);
