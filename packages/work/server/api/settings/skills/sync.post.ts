import { createError } from 'h3';
import { rateLimit } from '../../../utils/rate-limit';
import { syncSkillsFromFiles } from '../../../utils/skill-files';

/**
 * 从 WORK_SKILL_ROOTS 扫描 Markdown 并 upsert 到 skills 表。
 * 只增/改，不删；手工建的技能不受影响。
 */
export default defineEventHandler(async () => {
    const limited = await rateLimit('settings:skills:sync', 3, 60_000);
    if (!limited.ok) throw createError({ statusCode: 429, statusMessage: '同步过于频繁，请稍后再试' });
    return syncSkillsFromFiles();
});
