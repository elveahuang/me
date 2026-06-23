import { resolve } from 'node:path';
import { initModule, updateModule } from './utils.mjs';

const root = resolve(process.cwd());
console.log(`Current workspace - ${root}`);
// 更新模块依赖
await updateModule(resolve(root, 'packages/commons'));
await updateModule(resolve(root, 'packages/config'));
await updateModule(resolve(root, 'packages/mobile'));
await updateModule(resolve(root, 'packages/webapp'));
await updateModule(resolve(root));
// 安装模块依赖
await initModule(resolve(root));
