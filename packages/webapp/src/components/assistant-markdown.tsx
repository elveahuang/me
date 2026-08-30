import { MarkdownClient } from '@comark/react';
import jsonRender from '@comark/react/plugins/json-render';
import { useMemo } from 'react';
import { uiComponents } from './ui-components';

interface AssistantMarkdownProps {
    content: string;
    streaming?: boolean;
}

/**
 * 助手回复渲染管线：
 * Comark（Markdown + 组件语法 + 流式 autoClose）+ json-render 插件（渲染 ```json-render UI 规范）。
 */
export function AssistantMarkdown({ content, streaming = false }: AssistantMarkdownProps) {
    const plugins = useMemo(() => [jsonRender()], []);
    return (
        <MarkdownClient
            className='assistant-prose'
            value={content}
            streaming={streaming}
            caret={streaming ? { class: 'animate-pulse' } : false}
            plugins={plugins}
            components={uiComponents}
        />
    );
}
