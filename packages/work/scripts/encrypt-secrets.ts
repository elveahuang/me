import { db } from '../server/utils/db';
import { encryptLegacySecrets } from '../server/utils/secret-migration';

/**
 * 批量加密历史明文密钥（P4）：`pnpm --filter @repo/work secrets:encrypt [-- --dry-run]`。
 *
 * 只处理明文，已加密行跳过；未配置 WORK_SECRET_KEY 时什么都不写。
 * 建议先 `--dry-run` 看数量，再正式执行并重启应用。
 */
async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const result = await encryptLegacySecrets({ dryRun });
    console.log(JSON.stringify(result, null, 2));
    if (!result.keyConfigured) {
        console.error('[secrets] 未配置 WORK_SECRET_KEY，未执行任何写入');
        process.exitCode = 1;
    } else if (dryRun) {
        console.log('[secrets] 这是 dry-run，未写入数据库');
    } else {
        console.log(
            `[secrets] 已加密 ${result.total} 行（providers=${result.providers} storage=${result.storageConfigs} mcp=${result.mcpServers} tools=${result.tools}）`,
        );
    }
    await db.$client.end();
}

main().catch(async (error) => {
    console.error('[secrets] 批量加密失败:', error);
    await db.$client.end().catch(() => undefined);
    process.exit(1);
});
