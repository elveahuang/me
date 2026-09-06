import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const toneBadgeClasses: Record<string, string> = {
    info: 'bg-sky-100 text-sky-800 border-sky-200',
    success: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    warning: 'bg-amber-100 text-amber-800 border-amber-200',
    danger: 'bg-rose-100 text-rose-800 border-rose-200',
    neutral: 'bg-gray-100 text-gray-700 border-gray-200',
};

const alertBoxClasses: Record<string, string> = {
    info: 'border-sky-300 bg-sky-50 text-sky-900',
    success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
    danger: 'border-rose-300 bg-rose-50 text-rose-900',
};

export interface MobileCardProps {
    title?: string;
    description?: string;
    children?: React.ReactNode;
}

export function MobileCard({ title, description, children }: MobileCardProps) {
    return (
        <div className='my-2.5 rounded-xl border border-gray-200 bg-white p-3.5 shadow-xs'>
            {title ? <div className='text-sm font-semibold text-gray-900'>{title}</div> : null}
            {description ? <div className='mt-0.5 text-xs text-gray-500'>{description}</div> : null}
            {children ? <div className='mt-2 space-y-1.5'>{children}</div> : null}
        </div>
    );
}

export interface MobileStatProps {
    label?: string;
    value?: string;
    hint?: string;
}

export function MobileStat({ label, value, hint }: MobileStatProps) {
    return (
        <div className='my-1 mr-2 inline-flex min-w-[110px] flex-col rounded-xl border border-gray-200 bg-gray-50/90 px-3 py-2'>
            {label ? <span className='text-[11px] font-medium text-gray-500'>{label}</span> : null}
            <span className='mt-0.5 text-xl font-bold tracking-tight text-gray-900 tabular-nums'>{value ?? '—'}</span>
            {hint ? <span className='mt-0.5 text-[10px] text-gray-400'>{hint}</span> : null}
        </div>
    );
}

export interface MobileBadgeProps {
    label?: string;
    tone?: string;
}

export function MobileBadge({ label, tone = 'neutral' }: MobileBadgeProps) {
    const cls = toneBadgeClasses[tone ?? 'neutral'] ?? toneBadgeClasses.neutral;
    return <span className={`my-0.5 inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

export interface MobileAlertProps {
    message?: string;
    level?: string;
}

export function MobileAlert({ message, level = 'info' }: MobileAlertProps) {
    const cls = alertBoxClasses[level ?? 'info'] ?? alertBoxClasses.info;
    return (
        <div className={`my-2 rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed ${cls}`} role='alert'>
            {message}
        </div>
    );
}

interface RenderNode {
    type?: string;
    component?: string;
    props?: Record<string, any>;
    children?: RenderNode[] | RenderNode | string;
}

function renderComponentNode(node: unknown, key: string | number): React.ReactNode {
    if (!node || typeof node !== 'object') {
        if (typeof node === 'string' || typeof node === 'number') {
            return <span key={key}>{String(node)}</span>;
        }
        return null;
    }

    const n = node as RenderNode;
    const compType = (n.type || n.component || '').trim();
    const props = n.props ?? {};

    const renderChildren = () => {
        if (!n.children) return null;
        if (Array.isArray(n.children)) {
            return n.children.map((child, idx) => renderComponentNode(child, `${key}-${idx}`));
        }
        return renderComponentNode(n.children, `${key}-c`);
    };

    switch (compType) {
        case 'Card':
            return (
                <MobileCard key={key} title={props.title} description={props.description}>
                    {renderChildren()}
                </MobileCard>
            );
        case 'Stat':
            return <MobileStat key={key} label={props.label} value={props.value} hint={props.hint} />;
        case 'Badge':
            return <MobileBadge key={key} label={props.label} tone={props.tone} />;
        case 'Alert':
            return <MobileAlert key={key} message={props.message} level={props.level} />;
        default:
            // 未知组件降级渲染 children 或 props 提示
            if (n.children) {
                return <div key={key}>{renderChildren()}</div>;
            }
            return null;
    }
}

/**
 * 将 json-render 文本块解析并转换为移动端原生 React 组件树
 */
export function renderJsonRenderBlock(jsonContent: string, key: string | number): React.ReactNode {
    const trimmed = jsonContent.trim();
    if (!trimmed) return null;

    try {
        const parsed = JSON.parse(trimmed);

        if (Array.isArray(parsed)) {
            return (
                <div key={key} className='my-2 flex flex-wrap items-center gap-1.5'>
                    {parsed.map((item, idx) => renderComponentNode(item, `${key}-${idx}`))}
                </div>
            );
        }

        if (parsed && typeof parsed === 'object') {
            // 支持 { root: { ... } } 格式
            if (parsed.root && typeof parsed.root === 'object') {
                return renderComponentNode(parsed.root, key);
            }
            return renderComponentNode(parsed, key);
        }
    } catch {
        // 如果 JSON 尚在流式生成中或格式不完整，展示优雅的骨架卡片，不破坏移动端视觉
        return (
            <div key={key} className='my-2 animate-pulse rounded-xl border border-blue-200 bg-blue-50/60 p-3 text-xs text-blue-600'>
                ✨ 正在生成结构化内容…
            </div>
        );
    }

    return null;
}

export interface MobileCodeBlockProps {
    code: string;
    language?: string;
}

export function MobileCodeBlock({ code, language }: MobileCodeBlockProps) {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // ignore
        }
    };

    return (
        <div className='my-2.5 overflow-hidden rounded-xl border border-gray-800 bg-gray-950 text-gray-100 shadow-xs'>
            <div className='flex items-center justify-between border-b border-gray-800/80 bg-gray-900/80 px-3 py-1.5 text-xs text-gray-400'>
                <span className='font-mono text-[11px] font-medium tracking-wide text-gray-300 uppercase'>{language || 'code'}</span>
                <button
                    type='button'
                    onClick={handleCopy}
                    className='inline-flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[11px] text-gray-300 transition-colors hover:bg-gray-800'
                >
                    {copied ? `✓ ${t('chat.copied')}` : `📋 ${t('chat.copyCode')}`}
                </button>
            </div>
            <pre className='overflow-x-auto p-3 font-mono text-xs leading-relaxed text-gray-200'>
                <code>{code}</code>
            </pre>
        </div>
    );
}

function renderInlineTokens(text: string, baseKey: string | number): React.ReactNode[] {
    const tokens = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
    return tokens.map((tok, i) => {
        const key = `${baseKey}-tok-${i}`;
        if (tok.startsWith('`') && tok.endsWith('`') && tok.length >= 2) {
            return (
                <code key={key} className='rounded border border-gray-200 bg-gray-100 px-1 py-0.5 font-mono text-[12px] text-rose-600'>
                    {tok.slice(1, -1)}
                </code>
            );
        }
        if (tok.startsWith('**') && tok.endsWith('**') && tok.length >= 4) {
            return (
                <strong key={key} className='font-semibold text-gray-900'>
                    {tok.slice(2, -2)}
                </strong>
            );
        }
        return <span key={key}>{tok}</span>;
    });
}

interface FormattedSegment {
    type: 'prose' | 'code';
    content: string;
    language?: string;
}

function parseFormattedSegments(text: string): FormattedSegment[] {
    const segments: FormattedSegment[] = [];
    const codeRegex = /```([a-zA-Z0-9_-]*)\s*([\s\S]*?)(?:```|$)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = codeRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ type: 'prose', content: text.slice(lastIndex, match.index) });
        }
        const lang = match[1]?.trim() || undefined;
        const code = match[2] ?? '';
        segments.push({ type: 'code', content: code, language: lang });
        lastIndex = codeRegex.lastIndex;
        if (!match[0].endsWith('```')) {
            break;
        }
    }

    if (lastIndex < text.length) {
        segments.push({ type: 'prose', content: text.slice(lastIndex) });
    }

    return segments;
}

function renderFormattedText(text: string, keyPrefix: string | number): React.ReactNode {
    const segments = parseFormattedSegments(text);
    return segments.map((seg, i) => {
        const key = `${keyPrefix}-s-${i}`;
        if (seg.type === 'code') {
            return <MobileCodeBlock key={key} code={seg.content} language={seg.language} />;
        }
        return (
            <span key={key} style={{ whiteSpace: 'pre-wrap' }}>
                {renderInlineTokens(seg.content, key)}
            </span>
        );
    });
}

interface MobileMessageContentProps {
    text: string;
    reasoning?: string;
    streaming?: boolean;
}

/**
 * 移动端智能体消息内容渲染器：
 * 1. 拆分普通文字与 ```json-render ... ``` 结构化 UI 块
 * 2. 普通文本支持标准代码块卡片（带语言标牌与一键复制）与行内重点样式
 * 3. 将 json-render 代码块自动渲染为移动端原生卡片/指标/徽章/提示
 * 4. 展开/折叠显示模型的思考过程（Reasoning / Think）
 */
export function MobileMessageContent({ text, reasoning, streaming = false }: MobileMessageContentProps) {
    const parts: { type: 'text' | 'json-render'; content: string }[] = [];

    // 正则提取 ```json-render ... ``` 代码块，兼容尚未闭合的流式末尾
    const regex = /```json-render\s*([\s\S]*?)(?:```|$)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
        }
        parts.push({ type: 'json-render', content: match[1] ?? '' });
        lastIndex = regex.lastIndex;
        // 如果未闭合则说明已消费到字符串末尾
        if (!match[0].endsWith('```')) {
            break;
        }
    }

    if (lastIndex < text.length) {
        parts.push({ type: 'text', content: text.slice(lastIndex) });
    }

    if (parts.length === 0 && !reasoning) {
        return <span>{text || (streaming ? '…' : '')}</span>;
    }

    return (
        <div className='flex flex-col text-sm text-gray-800'>
            {reasoning ? (
                <details className='mb-2 rounded-lg border border-purple-200 bg-purple-50/70 p-2.5 text-xs text-purple-900' open={streaming && !text.trim()}>
                    <summary className='cursor-pointer font-medium text-purple-700 select-none'>
                        💭 思考过程 {streaming && !text.trim() ? '（思考中…）' : ''}
                    </summary>
                    <div className='mt-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-purple-800 opacity-90'>{reasoning}</div>
                </details>
            ) : null}

            {parts.map((p, idx) => {
                if (p.type === 'json-render') {
                    return renderJsonRenderBlock(p.content, idx);
                }
                return renderFormattedText(p.content, idx);
            })}
        </div>
    );
}
