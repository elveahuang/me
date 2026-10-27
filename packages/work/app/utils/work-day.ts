/**
 * 表单的日期/钟点取值：客户端这一份与服务端 `server/utils/work-day.ts` 同一口径（北京日）。
 *
 * 单独成文件有两个原因：
 * - `work.ts` 顶部 import 了 `@commons/contract`，`pnpm work:test`（tsx 直跑）解析不到这个构建期别名，
 *   纯函数放那儿就没法被冒烟测试导入；这里零依赖，前后端两份算法才能放进同一个断言里对拍。
 * - 这一组是「形状校验 + 时区折叠」，没有任何展示语义，和 `scheduleSummary` 那类文案函数不是一回事。
 */

/** 北京时间相对 UTC 的固定偏移（没有夏令时，所以一个常量就够）。 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 时间输入框（`<input type="time">`）的取值。
 *
 * 排期的 `timeText` 是「北京时间的 HH:mm」这个**字面量**，
 * 不是可解析的绝对时刻，所以这里只做形状校验，绝不做 `new Date(...)` 转换。
 */
export function timeTextInputValue(raw: string | null | undefined): string {
    const value = (raw ?? '').trim();
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value) ? value : '';
}

/**
 * 绝对时刻 → 北京日 `YYYY-MM-DD`。
 *
 * 刻意不用 `getFullYear()/getDate()`（浏览器本地）：`composeStartsAt` 把用户选的日期按**北京日**
 * 解释，两侧口径不一致时，在 UTC 或偏东机器上「今天 07:00」会回填成昨天，用户点保存就把排期提前了一天。
 */
function beijingDayKey(at: Date): string {
    return new Date(at.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/** 日期输入框取值（YYYY-MM-DD）；空值回退空串而不是 undefined，供 v-model 直接用。 */
export function dayInputValue(iso: string | null | undefined): string {
    if (!iso) return '';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : beijingDayKey(date);
}

/** 北京日口径下的「今天」，供相对日比较与表单默认值。 */
export function todayInputValue(): string {
    return beijingDayKey(new Date());
}

/**
 * 表单的「日期 + 钟点」合成一个绝对时刻（ISO 串）交给 `startsAt`。
 *
 * 钟点按北京时间解释——这与 `timeText` 同一口径，绝不能改成按浏览器时区构造 `new Date(...)`：
 * 那会让容器/跨时区机器上「明天 09:00」存成别的时刻，而用户看到的排期说明仍然写着 09:00。
 * 分钟级的时区偏移用 `Date.UTC` 减去固定偏移来表达，不需要引入时区库。
 */
export function composeStartsAt(day: string, time: string): string | null {
    const matchedDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
    if (!matchedDay) return null;
    const matchedTime = timeTextInputValue(time) || '09:00';
    const [y, m, d] = [Number(matchedDay[1]), Number(matchedDay[2]), Number(matchedDay[3])];
    const [hh, mm] = matchedTime.split(':').map(Number);
    const beijingDate = new Date(Date.UTC(y, m - 1, d, hh, mm));
    if (Number.isNaN(beijingDate.getTime())) return null;
    // `Date.UTC` 会把 2 月 30 日、13 月 1 日这类「日历上不存在的输入」顺延成别的一天，
    // 回指校验才能把它挡回去（与服务端 `assertRealCalendarDay` 同一规则）：否则用户选 2/30 存下的是 3/2，
    // 界面上的排期说明也写着 3/2，看起来像「系统把我的日期改了」。
    if (beijingDate.toISOString().slice(0, 10) !== `${matchedDay[1]}-${matchedDay[2]}-${matchedDay[3]}`) return null;
    return new Date(beijingDate.getTime() - BEIJING_OFFSET_MS).toISOString();
}
