import { requireAdmin } from '../../utils/guard';
import { readSystemSettings, writeSystemSettings, type SystemSettings } from '../../utils/system-settings';

/**
 * 系统基础设置（管理端单例行）。
 *
 * 生效链路：
 * - GET 直接读库，返回权威值给表单回填。
 * - PATCH 校验后写库，并刷新本进程的 public runtimeConfig，令 SSR 首屏（标题/默认语言/默认主题）立即拿到新值。
 * - 多实例部署时其他进程要到下次重启或各自被 PATCH 才刷新，属于可接受的最终一致（详见 AGENTS.md）。
 */

const LOCALES = ['zh-CN', 'en-US'];
const THEME_MODES = ['light', 'dark', 'system'];
const THEME_BRANDS = ['blue', 'green', 'yellow', 'red'];

const SITE_TITLE_MAX = 60;

function badRequest(message: string): never {
    throw createError({ statusCode: 400, statusMessage: message });
}

/** 只挑选合法字段；未提交的列保持原值（writeSystemSettings 的 patch 语义） */
function buildPatch(body: Record<string, unknown>): Partial<SystemSettings> {
    const patch: Partial<SystemSettings> = {};

    if (body.siteTitle !== undefined) {
        const title = String(body.siteTitle).trim();
        if (!title) badRequest('系统标题不能为空');
        if (title.length > SITE_TITLE_MAX) badRequest(`系统标题最长 ${SITE_TITLE_MAX} 个字符`);
        patch.siteTitle = title;
    }
    if (body.defaultLocale !== undefined) {
        const locale = String(body.defaultLocale);
        if (!LOCALES.includes(locale)) badRequest('默认语言不受支持');
        patch.defaultLocale = locale;
    }
    if (body.themeMode !== undefined) {
        const mode = String(body.themeMode);
        if (!THEME_MODES.includes(mode)) badRequest('默认显示模式不受支持');
        patch.themeMode = mode;
    }
    if (body.themeBrand !== undefined) {
        const brand = String(body.themeBrand);
        if (!THEME_BRANDS.includes(brand)) badRequest('默认品牌色不受支持');
        patch.themeBrand = brand;
    }

    return patch;
}

export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    if (getMethod(event) === 'PATCH') {
        const body = ((await readBody(event)) ?? {}) as Record<string, unknown>;
        const patch = buildPatch(body);
        const next = await writeSystemSettings(patch);

        const config = useRuntimeConfig(event);
        Object.assign(config.public.siteSettings, next);

        return next;
    }

    return readSystemSettings();
});
