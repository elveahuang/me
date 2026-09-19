import { eq } from 'drizzle-orm';
import { systemSettings } from '../db/schema';
import { db } from './db';

export interface SystemSettings {
    siteTitle: string;
    defaultLocale: string;
    themeMode: string;
    themeBrand: string;
}

/** 内建默认：库中尚无单行时前台据此渲染，不写库 */
export const SYSTEM_SETTINGS_DEFAULTS: SystemSettings = {
    siteTitle: 'ME',
    defaultLocale: 'zh-CN',
    themeMode: 'system',
    themeBrand: 'green',
};

/**
 * 进程内当前设置：启动插件从数据库载入，管理端 PATCH 后同步刷新。
 * Nitro 对共享 runtimeConfig 做了 deepFreeze，无法原地改写，SSR 侧由
 * server/plugins/site-settings.ts 的 request 钩子把这里的值注入每个请求的
 * event 级配置克隆；本进程的接口直接读这里。
 */
let currentSettings: SystemSettings = { ...SYSTEM_SETTINGS_DEFAULTS };

export function getCurrentSystemSettings(): SystemSettings {
    return { ...currentSettings };
}

export function setCurrentSystemSettings(next: SystemSettings): void {
    currentSettings = { ...next };
}

const SINGLETON_ID = 'default';

export function readSystemSettings(): Promise<SystemSettings> {
    return db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.id, SINGLETON_ID))
        .limit(1)
        .then((rows) => {
            const row = rows[0];
            if (!row) return { ...SYSTEM_SETTINGS_DEFAULTS };
            return {
                siteTitle: row.siteTitle,
                defaultLocale: row.defaultLocale,
                themeMode: row.themeMode,
                themeBrand: row.themeBrand,
            };
        });
}

/** upsert 单行设置；patch 里缺省的列沿用当前值/建表默认 */
export async function writeSystemSettings(patch: Partial<SystemSettings>): Promise<SystemSettings> {
    await db
        .insert(systemSettings)
        .values({ id: SINGLETON_ID, ...patch, updatedAt: new Date() })
        .onConflictDoUpdate({ target: systemSettings.id, set: { ...patch, updatedAt: new Date() } });
    return readSystemSettings();
}
