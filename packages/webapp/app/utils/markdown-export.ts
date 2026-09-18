export interface ExportMessagePart {
    type: string;
    text?: string;
    reasoning?: string;
    output?: unknown;
    toolName?: string;
    [key: string]: unknown;
}

export interface ExportMessage {
    id?: string;
    role: 'user' | 'assistant' | 'system' | string;
    parts?: ExportMessagePart[];
    content?: string;
}

export interface ExportConversationOptions {
    title: string;
    agentName?: string;
    model?: string;
    exportTime?: string;
    messages: ExportMessage[];
}

/**
 * 将结构化会话（包含提问、深度思考思维链、回答、工具返回）序列化为规范的 GitHub-Flavored Markdown 文本
 */
export function formatConversationMarkdown(options: ExportConversationOptions): string {
    const { title, agentName = 'AI 智能体', model = '默认模型', exportTime = new Date().toLocaleString('zh-CN', { hour12: false }), messages } = options;

    const lines: string[] = [];

    // 头部元信息
    lines.push(`# 对话记录: ${title || '未命名对话'}`);
    lines.push('');
    lines.push(`- **智能体**: ${agentName}`);
    lines.push(`- **驱动模型**: \`${model}\``);
    lines.push(`- **导出时间**: ${exportTime}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const msg of messages) {
        if (!msg) continue;
        const roleHeader = msg.role === 'user' ? '### 👤 用户' : `### 🤖 ${agentName}`;
        lines.push(roleHeader);
        lines.push('');

        if (Array.isArray(msg.parts) && msg.parts.length > 0) {
            for (const part of msg.parts) {
                if (part.type === 'reasoning') {
                    const reasoningText = (part.reasoning ?? (part as any).text ?? '').trim();
                    if (reasoningText) {
                        lines.push('> 💭 **深度思考过程**：');
                        for (const rLine of reasoningText.split('\n')) {
                            lines.push(`> ${rLine}`);
                        }
                        lines.push('');
                    }
                } else if (part.type === 'text') {
                    if (part.text?.trim()) {
                        lines.push(part.text.trim());
                        lines.push('');
                    }
                } else if (part.type === 'file' || part.type === 'image') {
                    // 附件在导出里保留可点击链接，否则导出的记录会丢失用户发过的文件
                    const filePart = part as { url?: unknown; filename?: unknown };
                    const url = typeof filePart.url === 'string' ? filePart.url : '';
                    if (!url) continue;
                    const name = typeof filePart.filename === 'string' && filePart.filename ? filePart.filename : '附件';
                    lines.push(`📎 **${name}**：[打开](${url})`);
                    lines.push('');
                } else if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
                    const toolName = part.toolName || part.type.replace('tool-', '');
                    lines.push(`> 🛠️ **工具调用** (\`${toolName}\`):`);
                    if (part.output) {
                        lines.push('> ```json');
                        const jsonStr = typeof part.output === 'string' ? part.output : JSON.stringify(part.output, null, 2);
                        for (const jLine of jsonStr.split('\n')) {
                            lines.push(`> ${jLine}`);
                        }
                        lines.push('> ```');
                    }
                    lines.push('');
                }
            }
        } else if (msg.content) {
            lines.push(msg.content.trim());
            lines.push('');
        }

        lines.push('');
    }

    return lines.join('\n').trim() + '\n';
}

/**
 * 浏览器端触发直接下载 Markdown 文件
 */
export function downloadMarkdownFile(filename: string, content: string): void {
    if (typeof window === 'undefined') return;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename.endsWith('.md') ? filename : `${filename}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
