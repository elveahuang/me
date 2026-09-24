import { z } from 'zod';

/**
 * 管理端 plans 资源的数值字段（POST 与 PATCH 共用一份定义）。
 *
 * 这四列在 PostgreSQL 里都是 int4：只写 `.int()` 时超界值能顺利通过 zod，落到库里才报 22003
 * 数值溢出——响应变成 500 且带上 SQL 细节。范围必须在入参层就拦住，而不是交给数据库。
 */
const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;

function int4(label: string) {
    return z
        .number()
        .int(`${label}必须为整数`)
        .min(INT4_MIN, `${label}超出可存储范围（最多 ${INT4_MAX}）`)
        .max(INT4_MAX, `${label}超出可存储范围（最多 ${INT4_MAX}）`);
}

export const planQuotaPerDayField = int4('每日对话额度').positive('每日对话额度必须为正数').nullable();
export const planMonthlyPriceCentsField = int4('月价格（分）').min(0, '月价格不能为负');
export const planYearlyPriceCentsField = int4('年价格（分）').min(0, '年价格不能为负').nullable();
export const planSortOrderField = int4('排序值');
