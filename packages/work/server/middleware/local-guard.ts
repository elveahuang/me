import { blocksWrite } from '../utils/local-origin';

/**
 * work 没有账号体系，任何能连到本机端口的人等价于「就是你」。
 * 只绑回环地址挡住了远程访问，但挡不住浏览器：用户打开的任意外站页面都能向
 * http://127.0.0.1:3001/api/... 发跨域 POST，写脏任务、笔记和供应商配置。
 *
 * 因此这里对写方法做来源核验（判定逻辑在 server/utils/local-origin.ts，冒烟测试直接跑它）。
 */
export default defineEventHandler((event) => {
    const method = getMethod(event);
    if (method === 'OPTIONS') {
        // 没有跨域消费者，预检直接拒掉，省得回一串没人用的授权头
        setResponseStatus(event, 405);
        return '';
    }
    if (blocksWrite(method, getRequestHeader(event, 'origin'))) {
        throw createError({ statusCode: 403, statusMessage: '不允许来自本站之外的写入' });
    }
});
