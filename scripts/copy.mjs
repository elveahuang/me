import { resolve } from 'node:path';
import { clearPath, copyPath } from './utils.mjs';

const root = resolve(process.cwd());
console.log(`Current workspace - ${root}.`);
// 清空构建目录
await clearPath(resolve(root, 'server/public/static'));
// 复制前端模块
await copyPath(resolve(root, 'node_modules/layui/dist/'), resolve(root, 'server/public/static/layui'));
await copyPath(resolve(root, 'node_modules/jquery/dist/'), resolve(root, 'server/public/static/jquery'));
