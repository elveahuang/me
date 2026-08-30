import type { ReactNode } from 'react';

/**
 * json-render 组件目录（src/lib/catalog.ts）对应的 React 实现。
 * Comark 的 json-render 插件会把 ```json-render 代码块解析成这些组件节点。
 */

const toneClasses: Record<string, string> = {
    info: 'bg-sky-100 text-sky-700',
    success: 'bg-emerald-100 text-emerald-700',
    warning: 'bg-amber-100 text-amber-700',
    danger: 'bg-red-100 text-red-700',
    neutral: 'bg-gray-100 text-gray-700',
};

const alertToneClasses: Record<string, string> = {
    info: 'border-sky-300 bg-sky-50 text-sky-800',
    success: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    warning: 'border-amber-300 bg-amber-50 text-amber-800',
    danger: 'border-red-300 bg-red-50 text-red-800',
};

export function JrCard({ title, description, children }: { title?: string; description?: string; children?: ReactNode }) {
    return (
        <div className='my-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm'>
            {title ? <div className='text-base font-semibold text-gray-900'>{title}</div> : null}
            {description ? <div className='mt-0.5 text-sm text-gray-500'>{description}</div> : null}
            {children ? <div className='mt-2'>{children}</div> : null}
        </div>
    );
}

export function JrStat({ label, value, hint }: { label?: string; value?: string; hint?: string }) {
    return (
        <div className='my-3 inline-flex min-w-36 flex-col rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm'>
            <span className='text-xs font-medium text-gray-500'>{label}</span>
            <span className='mt-1 text-2xl font-bold tabular-nums text-gray-900'>{value}</span>
            {hint ? <span className='mt-0.5 text-xs text-gray-400'>{hint}</span> : null}
        </div>
    );
}

export function JrBadge({ label, tone = 'neutral' }: { label?: string; tone?: string }) {
    return (
        <span className={`my-0.5 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone] ?? toneClasses.neutral}`}>
            {label}
        </span>
    );
}

export function JrAlert({ message, level = 'info' }: { message?: string; level?: string }) {
    return (
        <div className={`my-3 rounded-lg border px-4 py-2 text-sm ${alertToneClasses[level] ?? alertToneClasses.info}`} role='alert'>
            {message}
        </div>
    );
}

/** 传给 Comark `<Markdown components={...}>` 的映射表 */
export const uiComponents = {
    Card: JrCard,
    Stat: JrStat,
    Badge: JrBadge,
    Alert: JrAlert,
};
