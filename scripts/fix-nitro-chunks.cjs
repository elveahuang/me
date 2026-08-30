/**
 * 修补 nitro(vite 8 rolldown) 构建产物中的 chunk 导出不匹配问题：
 * `_ssr/ssr.mjs` 的导出表引用了不存在的 `ssr_exports` 标识符，
 * 其正确值是已从 ssr2.mjs 导入的 `server_default`（`o` 槽位）。
 * 上游修复后此脚本会自动变成空操作。
 */
const fs = require('fs');
const path = require('path');

const target = path.resolve('packages/webapp/.output/server/_ssr/ssr.mjs');
if (!fs.existsSync(target)) {
    console.log('[fix-nitro-chunks] no ssr.mjs, skip');
    process.exit(0);
}

let patched = 0;
let content = fs.readFileSync(target, 'utf8');
if (content.includes('ssr_exports as o')) {
    content = content.replace('ssr_exports as o', 'server_default as o');
    fs.writeFileSync(target, content);
    patched++;
}

console.log(`[fix-nitro-chunks] patched ${patched} occurrence(s) in _ssr/ssr.mjs`);
