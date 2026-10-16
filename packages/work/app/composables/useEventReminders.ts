/**
 * 日程提醒的到点提示。
 *
 * 抽屉里设好的 `reminderAt` 过去只是一列写在库里的时间，界面上没有任何东西会因为它而发生变化——
 * 加一个铃铛只是让它「看得见」，这一处才让它「有用」。
 *
 * 三个刻意的取舍：
 * - 只在本页开着的时候提示。工作台没有后台守护，也没有推送通道，浏览器关掉以后没人负责叫醒用户，
 *   与其假装能送达，不如把口径说清楚：这是一条「你正在用这台机器时」的提示。
 * - 迟到的提醒只认 5 分钟。标签页被浏览器节流到 1 次/分，回来时可能已经过了半小时，
 *   这时候弹一条「该开会了」比不弹更误导人。
 * - 触发过就写进 localStorage（键到 `reminderAt` 本身）。刷新页面不会重复弹，
 *   而用户改了提醒时间会重新算一次。
 */
const POLL_MS = 60_000;
const LATE_GRACE_MS = 5 * 60_000;
const FIRED_KEY = 'work_reminder_fired';
const FIRED_MAX = 200;

interface ReminderEvent {
    id: string;
    title: string;
    startsAt: string;
    reminderAt: string | null;
}

/** 服务端 `?reminder=1` 只回有提醒的日程；提醒列本身可空，类型上仍要过一遍 */
function firedKey(event: ReminderEvent): string {
    return `${event.id}:${event.reminderAt}`;
}

function readFired(): Set<string> {
    if (import.meta.server) return new Set();
    try {
        const raw = JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]');
        // 合法的 JSON 也可能是 null/数字，Array.isArray 之前不能用数组方法
        if (!Array.isArray(raw)) return new Set();
        return new Set(raw.filter((item): item is string => typeof item === 'string').slice(-FIRED_MAX));
    } catch {
        return new Set();
    }
}

function writeFired(fired: Set<string>): void {
    if (import.meta.server) return;
    try {
        localStorage.setItem(FIRED_KEY, JSON.stringify([...fired].slice(-FIRED_MAX)));
    } catch {
        // 隐私模式或配额满：提示照弹，只是刷新后会重复一次，不值得为此打断轮询
    }
}

const due = ref<ReminderEvent | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;
let polling = false;

async function pollOnce(): Promise<void> {
    if (polling || import.meta.server) return;
    polling = true;
    try {
        const list = await $fetch<ReminderEvent[]>('/api/events', { query: { reminder: '1', limit: 200 } });
        const now = Date.now();
        const fired = readFired();
        let changed = false;
        for (const event of list) {
            const at = Date.parse(event.reminderAt ?? '');
            if (Number.isNaN(at) || at > now || now - at > LATE_GRACE_MS) continue;
            const key = firedKey(event);
            if (fired.has(key)) continue;
            fired.add(key);
            changed = true;
            // 一轮只报一条：同时到点的日程本来罕见，全部堆进一个浮层反而读不完
            if (!due.value) due.value = event;
        }
        if (changed) writeFired(fired);
    } catch {
        // 轮询失败不做界面提示：下一分钟自然重试，而这一刻弹一条「提醒接口挂了」只会盖掉真正要看的日程
    } finally {
        polling = false;
    }
}

function startPolling() {
    if (import.meta.server || timer) return;
    void pollOnce();
    timer = setInterval(() => {
        // 标签页在后台时浏览器会把定时器压到 1 次/分，这里直接跳过：
        // 回到前台那一刻由 visibilitychange 立刻补一次，比在被压着的时间表上空转干净。
        if (document.visibilityState === 'visible') void pollOnce();
    }, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
}

function onVisible() {
    if (document.visibilityState === 'visible') void pollOnce();
}

export function useEventReminders() {
    function dismiss() {
        due.value = null;
    }

    /** 布局卸载时把定时器与监听一起摘掉——SPA 里布局也可能因换 layout 而重建 */
    function stopPolling() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        if (import.meta.client) document.removeEventListener('visibilitychange', onVisible);
    }

    return { due, dismiss, startPolling, stopPolling };
}
