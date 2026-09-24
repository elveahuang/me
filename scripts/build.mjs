import { resolve } from 'node:path';
import { buildModule, clearPath, copyPath } from './utils.mjs';

const root = resolve(process.cwd());
const args = process.argv.splice(2);
const profile = args && args.length && args.length > 0 ? args[0] : 'pro';
console.log(`Current workspace - ${root}. profile - ${profile}`);
// 编译构建标准模块
await buildModule('webapp', profile);
await buildModule('mobile', profile);
// 清空构建目录，并复制各模块的构建结果
await clearPath(resolve(root, 'dist'));
await copyPath(resolve(root, 'packages/mobile/dist/'), resolve(root, 'dist/mobile'));
await copyPath(resolve(root, 'packages/webapp/dist/'), resolve(root, 'dist/webapp'));
