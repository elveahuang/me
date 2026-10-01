/**
 * 生成 Web 端本地图标表（app/utils/app-icons.ts）。
 *
 * 为什么不用 @nuxt/icon 的运行时加载：
 * 图标名一旦写在模板里，客户端会去 api.iconify.design 拉取 SVG。离线、内网或被墙的网络下
 * 会退化成空白方块（本项目已因字体源不可达调整过 fonts 配置）。
 * 这里在构建期从已安装的 @iconify-json/mdi 里抽出用到的图标，内联成静态 SVG 数据，
 * 运行时零网络请求，只打包真正用到的图标。
 *
 * 用法：
 *   pnpm --filter @repo/webapp icons         # 重新生成
 *   pnpm --filter @repo/webapp icons --check # 只校验，不写文件（CI 用）
 *
 * 新增图标：把 Iconify 名字（不带 `mdi-` 前缀，如 `account-circle`）加到 NAMES 里再执行。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(HERE, '../app/utils/app-icons.ts');

/** 需要打包进客户端的图标（Iconify mdi 名称，不带前缀） */
const NAMES = [
    // 外壳 / 导航
    'menu',
    'close',
    'chevron-down',
    'chevron-up',
    'chevron-left',
    'chevron-right',
    'arrow-left',
    'arrow-right',
    'arrow-up',
    'arrow-down',
    'dots-vertical',
    'dots-horizontal',
    'external-link',
    'open-in-new',
    'plus',
    'minus',
    'magnify',
    'close-circle-outline',
    'filter-variant',
    'filter-off-outline',
    'sort-variant',
    'refresh',
    'check',
    'check-all',
    'check-circle-outline',
    // 外观
    'white-balance-sunny',
    'moon-waning-crescent',
    'monitor',
    'palette-outline',
    'theme-light-dark',
    // 账号
    'account-outline',
    'account-circle-outline',
    'account-group-outline',
    'account-multiple-plus-outline',
    'login-variant',
    'logout-variant',
    'translate',
    'cog-outline',
    'shield-account-outline',
    'shield-check-outline',
    'lock-outline',
    'key-variant',
    'email-outline',
    // 对话
    'message-text-outline',
    'chat-outline',
    'send',
    'send-outline',
    'stop-circle-outline',
    'content-copy',
    'pencil-outline',
    'trash-can-outline',
    'download-outline',
    'upload-outline',
    'paperclip',
    'thought-bubble-outline',
    'lightbulb-outline',
    'emoticon-happy-outline',
    'robot-outline',
    'dots-grid',
    'plus-circle-outline',
    // AI 资产
    'creation-outline',
    'wrench-outline',
    'wrench-cog-outline',
    'lightning-bolt-outline',
    'server-network',
    'server-outline',
    'power-plug-outline',
    'book-open-page-variant-outline',
    'database-outline',
    'brain',
    'api',
    'xml',
    'code-json',
    'file-document-outline',
    'folder-outline',
    'link-variant',
    'cloud-upload-outline',
    'autorenew',
    // 运营 / 计费
    'view-dashboard-outline',
    'credit-card-outline',
    'receipt-text-outline',
    'cash-multiple',
    'chart-line',
    'chart-donut',
    'trending-up',
    'ticket-confirmation-outline',
    'crown-outline',
    'infinity',
    'rocket-launch-outline',
    'gift-outline',
    'qrcode',
    'calendar-outline',
    'clock-outline',
    'history',
    'star-outline',
    'star',
    'alert-circle-outline',
    'alert-outline',
    'information-outline',
    'help-circle-outline',
    'eye-outline',
    'eye-off-outline',
    'table-of-contents',
    'view-list-outline',
    'text-box-outline',
    // 附件管理 / 对象存储
    'cloud-outline',
    'cloud-check-outline',
    'cloud-cog-outline',
    'database-cog-outline',
    'harddisk',
    'folder-multiple-outline',
    'package-variant-closed',
    'tray-arrow-up',
    'tray-arrow-down',
    'file-outline',
    'file-image-outline',
    'file-pdf-box',
    'file-word-outline',
    'file-excel-outline',
    'zip-box-outline',
    'music-box-outline',
    'video-outline',
    'shield-lock-outline',
    // 资讯 / 宣传栏 / 通知
    'newspaper',
    'newspaper-variant-outline',
    'bullhorn',
    'bullhorn-outline',
    'bell-outline',
    'bell-badge-outline',
    'send-check-outline',
    'tag-outline',
    'pin-outline',
    'earth',
    'bookmark-outline',
    'clock-check-outline',
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
 * 本文件由 packages/webapp/scripts/generate-icons.mjs 自动生成，请勿手动修改。
 * 重新生成：pnpm --filter @repo/webapp icons
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
        console.error('✖ app-icons.ts 与脚本中的图标清单不一致，请执行 pnpm --filter @repo/webapp icons');
        process.exit(1);
    }
    console.log(`√ app-icons.ts 已是最新（${entries.length} 个图标）`);
} else {
    writeFileSync(OUTPUT, output, 'utf8');
    console.log(`√ 已生成 app-icons.ts（${entries.length} 个图标，${(output.length / 1024).toFixed(1)} KB）`);
}
