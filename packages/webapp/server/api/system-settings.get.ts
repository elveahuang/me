import { getCurrentSystemSettings } from '../utils/system-settings';

/**
 * 公开系统设置探针（只读，无副作用）。
 *
 * 供前端读取站点标题、默认语言、默认主题。值来自进程内当前设置
 * （启动插件载入、管理端 PATCH 刷新，见 server/utils/system-settings.ts），
 * 不回源数据库、不含任何密钥。
 */
export default defineEventHandler(() => {
    return getCurrentSystemSettings();
});
