import { closeDbClient } from '../utils/db';

/**
 * 数据库连接池关闭钩子，用于解决本地编译成功后也无法正常退出的问题
 */
export default defineNitroPlugin((nitroApp): void => {
    nitroApp.hooks.hook('close', async (): Promise<void> => {
        try {
            await closeDbClient();
        } catch (error) {
            console.warn('Fail to Close DataSource Pool:', (error as Error)?.message || error);
        }
    });
});
