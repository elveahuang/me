import { resolve } from 'node:path';
import { buildModule, clearPath, copyFile, copyPath } from './utils.mjs';

const root = resolve(process.cwd());
const args = process.argv.splice(2);
const profile = args && args.length && args.length > 0 ? args[0] : 'pro';
console.log(`Current workspace - ${root}. profile - ${profile}`);
// 编译前端模块
await buildModule('webapp', profile);
await buildModule('mobile', profile);
await buildModule('admin', profile);
// 编译后端模块
await buildModule('app', profile);
// 清空构建目录
await clearPath(resolve(root, 'dist'));
// 复制前端模块
await copyPath(resolve(root, 'apps/admin/dist/'), resolve(root, 'dist/admin'));
await copyPath(resolve(root, 'apps/mobile/dist/'), resolve(root, 'dist/mobile'));
await copyPath(resolve(root, 'apps/webapp/dist/'), resolve(root, 'dist/webapp'));
await copyPath(resolve(root, 'tools/public/'), resolve(root, 'dist'));
// 复制后端模块
await copyPath(resolve(root, 'server/app/dist/'), resolve(root, 'dist/app/dist'));
await copyPath(resolve(root, 'server/app/views/'), resolve(root, 'dist/app/views'));
await copyPath(resolve(root, 'server/app/public/'), resolve(root, 'dist/app/public'));
await copyFile(resolve(root, 'server/app/package.json'), resolve(root, 'dist/app/package.json'));
await copyFile(resolve(root, 'server/app/tsconfig.build.json'), resolve(root, 'dist/app/tsconfig.build.json'));
await copyFile(resolve(root, 'server/app/tsconfig.json'), resolve(root, 'dist/app/tsconfig.json'));
