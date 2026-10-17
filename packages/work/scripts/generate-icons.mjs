/**
 * 生成工作台本地图标表（app/utils/app-icons.ts）。
 *
 * 为什么不用 @nuxt/icon 的运行时加载：
 * 图标名一旦写在模板里，客户端会去 api.iconify.design 拉取 SVG。离线、内网或被墙的网络下
 * 会退化成空白方块（本项目已因字体源不可达调整过 fonts 配置）。
 * 这里在构建期从已安装的 @iconify-json/mdi 里抽出用到的图标，内联成静态 SVG 数据，
 * 运行时零网络请求，只打包真正用到的图标。
 *
 * 用法：
 *   pnpm --filter @repo/work icons         # 重新生成
 *   pnpm --filter @repo/work icons --check # 只校验，不写文件（CI 用）
 *
 * 新增图标：把 Iconify 名字（不带 `mdi-` 前缀，如 `account-circle`）加到 NAMES 里再执行。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(HERE, '../app/utils/app-icons.ts');

/**
 * 需要打包进客户端的图标（Iconify mdi 名称，不带前缀）。
 *
 * 这份清单是从 webapp 那一套继承来的，删掉日历/项目/附件/命令面板之后大部分已经没有消费者。
 * 每个图标体都会内联进 `app/utils/app-icons.ts` 打进客户端包，留着就是纯体积，
 * 所以只保留 `app/**` 与 `server/**` 里还能 grep 到名字的行——清减后请跑
 * `pnpm --filter @repo/work icons` 重新生成，别让生成文件与这份清单漂移。
 */
const NAMES = [
    // 外壳 / 导航
    'menu',
    'close',
    'chevron-down',
    'chevron-right',
    'arrow-left',
    'plus',
    'magnify',
    'close-circle-outline',
    'check-circle-outline',
    // 外观
    'white-balance-sunny',
    'moon-waning-crescent',
    'monitor',
    // 账号与设置
    'account-outline',
    'cog-outline',
    // 行内操作与附件
    'pencil-outline',
    'trash-can-outline',
    'download-outline',
    'paperclip',
    'tray-arrow-up',
    'file-outline',
    'file-image-outline',
    // 对话
    'robot-outline',
    'brain',
    'creation-outline',
    // AI 能力与设置子页
    'wrench-outline',
    'lightning-bolt-outline',
    'power-plug-outline',
    'book-open-page-variant-outline',
    'database-outline',
    'view-dashboard-outline',
    'autorenew',
    // 定时任务 / 今日页
    'clock-outline',
    'timer-outline',
    'play-circle-outline',
    'newspaper-variant-outline',
    // 状态与标记
    'alert-circle-outline',
    'alert-outline',
    'tag-outline',
    'pin-outline',
].sort();

const collection = JSON.parse(readFileSync(resolve(HERE, '../../../node_modules/@iconify-json/mdi/icons.json'), 'utf8'));

/** mdi 里大量图标是别名，需要沿着 parent 链回溯到真实 body */
function resolveIcon(name) {
    const seen = new Set();
    let current = name;
    let depth = 0;
    while (depth++ < 8) {
        if (seen.has(current)) return null;
        seen.add(current);
        const icon = collection.icons[current];
        if (icon) return icon;
        const alias = collection.aliases?.[current];
        if (!alias) return null;
        current = alias.parent;
    }
    return null;
}

const missing = [];
const entries = [];
for (const name of NAMES) {
    const icon = resolveIcon(name);
    if (!icon) {
        missing.push(name);
        continue;
    }
    const width = icon.width ?? collection.width ?? 24;
    const height = icon.height ?? collection.height ?? 24;
    const viewBox = `0 0 ${width} ${height}`;
    // body 里已带 fill="currentColor"，直接内联即可继承文字颜色
    entries.push([name, viewBox, icon.body]);
}

if (missing.length) {
    console.error(`✖ 以下图标在 @iconify-json/mdi 中不存在：${missing.join(', ')}`);
    process.exit(1);
}

const lines = entries.map(([name, viewBox, body]) => `    '${name}': { viewBox: '${viewBox}', body: '${body.replace(/'/g, "\\'")}' },`);

const output = `/**
 * 本文件由 packages/work/scripts/generate-icons.mjs 自动生成，请勿手动修改。
 * 重新生成：pnpm --filter @repo/work icons
 *
 * 图标来自 @iconify-json/mdi（Apache-2.0），构建期内联，运行时无网络请求。
 */

export interface AppIconData {
    viewBox: string;
    /** SVG 内部标记，已包含 fill="currentColor"，颜色继承自文字色 */
    body: string;
}

export const APP_ICONS: Record<string, AppIconData> = {
${lines.join('\n')}
};

export type AppIconName = keyof typeof APP_ICONS;
`;

const checkOnly = process.argv.includes('--check');
if (checkOnly) {
    const current = readFileSync(OUTPUT, 'utf8');
    if (current !== output) {
        console.error('✖ app-icons.ts 与脚本中的图标清单不一致，请执行 pnpm --filter @repo/work icons');
        process.exit(1);
    }
    console.log(`√ app-icons.ts 已是最新（${entries.length} 个图标）`);
} else {
    writeFileSync(OUTPUT, output, 'utf8');
    console.log(`√ 已生成 app-icons.ts（${entries.length} 个图标，${(output.length / 1024).toFixed(1)} KB）`);
}
