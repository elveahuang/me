import { useI18nExternal } from '@commons/core/i18n';
import dayjs, { Dayjs } from 'dayjs';
import { isEmpty, isEqual, isNull } from 'lodash-es';

export declare type DATE_RANGE_PICKER_TYPE = 'datetime' | 'date' | 'time';
export const DATETIME_PATTEN: string = 'YYYY-MM-DD HH:mm:ss';
export const DATE_PATTEN: string = 'YYYY-MM-DD';
export const SIMPLE_DATE_PATTEN: string = 'MM-DD';
export const TIME_PATTEN: string = 'HH:mm:ss';
export const SIMPLE_TIME_PATTEN: string = 'HH:mm';
export const MAX_YEAR: number = 9999;
export const MIN_YEAR: number = 1970;

/**
 * 获取当前年份
 */
export function getYear(): number {
    return dayjs().year();
}

/**
 * 解析完整日期
 */
export function parseDatetime(obj: Date | number | string): Dayjs {
    if (!isNull(obj) && !isEmpty(obj)) {
        const dt: Dayjs = dayjs(obj, DATETIME_PATTEN);
        if (dt.year() == MAX_YEAR || dt.year() == MIN_YEAR) {
            return null;
        }
        return dt;
    }
    return null;
}

/**
 * 解析日期
 */
export function parseDate(obj: Date | number | string): Dayjs {
    if (!isNull(obj) && !isEmpty(obj)) {
        const dt: Dayjs = dayjs(obj, DATE_PATTEN);
        if (dt.year() == MAX_YEAR || dt.year() == MIN_YEAR) {
            return null;
        }
        return dt;
    }
    return null;
}

/**
 * 解析时间
 */
export function parseTime(obj: Date | number | string): Dayjs {
    if (!isNull(obj) && !isEmpty(obj)) {
        return dayjs(obj, TIME_PATTEN);
    }
    return null;
}

/**
 * 格式化日期
 */
export function formatDatetime(obj: Dayjs | Date | number | string, defaultValue: string = '--'): string {
    if (obj !== undefined) {
        const dt: Dayjs = dayjs(obj, DATE_PATTEN);
        if (dt.year() == MAX_YEAR || dt.year() == MIN_YEAR) {
            return defaultValue;
        }
        return dt.format(DATETIME_PATTEN);
    }
    return defaultValue;
}

/**
 * 格式化日期
 */
export function formatDate(obj: Dayjs | Date | number | string, defaultValue: string = '--'): string {
    if (obj !== undefined) {
        const dt: Dayjs = dayjs(obj, DATE_PATTEN);
        if (dt.year() == MAX_YEAR || dt.year() == MIN_YEAR) {
            return defaultValue;
        }
        return dt.format(DATE_PATTEN);
    }
    return defaultValue;
}

/**
 * 格式化日期
 */
export function formatDateByPattern(obj: Dayjs | Date | number | string, pattern: string = DATE_PATTEN, defaultValue: string = '--'): string {
    if (obj !== undefined) {
        const dt: Dayjs = dayjs(obj, pattern);
        if (dt.year() == MAX_YEAR || dt.year() == MIN_YEAR) {
            return defaultValue;
        }
        return dt.format(pattern);
    }
    return defaultValue;
}

/**
 * 格式化时间
 */
export function formatTime(obj: Dayjs | Date | number | string, defaultValue: string = '--'): string {
    if (obj !== undefined) {
        return dayjs(obj, TIME_PATTEN).format(TIME_PATTEN);
    }
    return defaultValue;
}

/**
 * 格式化时间
 */
export function formatTimeByPattern(obj: Dayjs | Date | number | string, pattern: string = TIME_PATTEN, defaultValue: string = '--'): string {
    if (obj !== undefined) {
        return dayjs(obj, pattern).format(pattern);
    }
    return defaultValue;
}

/**
 * 格式化月份
 */
export function formatMonth(dateObject: Date | number): string | number {
    if (dateObject !== undefined) {
        return dayjs(dateObject).month();
    }
    return '--';
}

/**
 * 格式化年份
 */
export function formatYear(dateObject: Date | number): string | number {
    if (dateObject !== undefined) {
        return dayjs(dateObject).year();
    }
    return '--';
}

/**
 * 格式化日期
 */
export function formatDatetimePeriod(from: Dayjs | Date | number | string, to: Dayjs | Date | number | string): string {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { t } = useI18nExternal();

    const formText: string = formatDatetime(from);
    const toText: string = formatDatetime(to);
    if (!isEqual(formText, '--') && !isEqual(toText, '--')) {
        return t('common.label_date_period_display_format_1', { start: formText, end: toText });
    } else if (!isEqual(formText, '--') && isEqual(toText, '--')) {
        return t('common.label_date_period_display_format_2', { start: formText });
    } else if (isEqual(formText, '--') && !isEqual(toText, '--')) {
        return t('common.label_date_period_display_format_3', { end: toText });
    } else if (isEqual(formText, '--') && isEqual(toText, '--')) {
        return t('common.label_date_period_display_format_4');
    }
    return '--';
}
