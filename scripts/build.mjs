import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { buildModule, clearPath, copyPath } from './utils.mjs';

const root = resolve(process.cwd());
const args = process.argv.splice(2);
const profile = args && args.length && args.length > 0 ? args[0] : 'pro';
console.log(`Current workspace - ${root}. profile - ${profile}`);
// 编译 Nuxt 全栈产物（packages/webapp）
await buildModule('webapp', profile);
// 清空构建目录
await clearPath(resolve(root, 'dist'));
// 复制服务端产物（Nitro 输出在 packages/webapp/.output）
if (existsSync(resolve(root, 'packages/webapp/.output'))) {
    await copyPath(resolve(root, 'packages/webapp/.output'), resolve(root, 'dist/webapp'));
} else {
    console.warn('未找到 packages/webapp/.output，跳过产物复制');
}
