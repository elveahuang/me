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

/** 导出文档的界面文案由调用方按当前语言传入，工具本身不再内置中文 */
export interface ExportLabels {
    doc: string;
    untitled: string;
    agent: string;
    agentDefault: string;
    model: string;
    modelDefault: string;
    exportedAt: string;
    user: string;
    reasoning: string;
    attachment: string;
    open: string;
    toolCall: string;
}

export interface ExportConversationOptions {
    title: string;
    messages: ExportMessage[];
    labels: ExportLabels;
    agentName?: string;
    model?: string;
    /** 导出时间展示串：调用方按当前语言格式化后传入；缺省用 ISO 串，工具本身不内置任何语言的格式 */
    exportTime?: string;
}

/**
 * 折成单行：这些字段会出现在标题行、列表行或引用行里，一旦带换行就在导出文档中
 * 另起一行，等于让（未受服务端 schema 约束的）客户端状态伪造标题、列表和工具块。
 * 非字符串一律折叠为空串，调用方据此回退到文案，`String(x)` 会把 undefined 变成字面量 "undefined"。
 */
function toInlineText(value: unknown): string {
    return typeof value === 'string' ? value.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim() : '';
}

/**
 * 行内代码 / 代码围栏的定界符长度。
 * CommonMark 允许内容里出现比定界符更短的反引号串，因此只要按内容里最长的连续反引号
 * 加长定界符，内容就无法提前闭合它——工具输出里的一段 ``` 曾会把围栏关掉，
 * 剩下的内容按正文渲染，其中的裸 URL 与 `###` 就成了可点击链接和真标题。
 *
 * 文件名也走这里而不是逐字符转义：GFM 会把正文里的裸 URL 自动链接化，`\*`、`\]` 挡不住
 * `报表](http://evil.test/ .pdf` 这种写法，代码段里则一切按字面呈现。
 */
function backtickRun(value: string): number {
    return Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
}

function inlineCode(value: string): string {
    const delimiter = '`'.repeat(backtickRun(value) + 1);
    // 内容首尾若紧邻定界符是空格或反引号，必须补空格，否则整段解析不成 code span
    const pad = value === '' || value.startsWith(' ') || value.endsWith(' ') || value.includes('`') ? ' ' : '';
    return `${delimiter}${pad}${value}${pad}${delimiter}`;
}

/**
 * 附件链接目标：只承认绝对 http(s) 地址与站内路径，其余返回 null 由调用方降级为纯文本。
 *
 * 三条都是这里特有的坑，不是泛化的 URL 校验：
 * - `)` 与空白会提前闭合 `[text](...)`，换行还能另起一行，导出文档里就会出现指向站外的
 *   可点击链接（文件名、模型输出同理，见 `toInlineText`）
 * - 协议相对地址 `//host/path` 只差一个字符，却是站外主机
 * - `data:` 虽然在服务端 part 白名单里（粘贴的图片），但它可能是几 MB 的 base64，
 *   整段灌进 .md 会让导出文件膨胀；`javascript:` 之类在部分渲染器里可直接执行
 */
function safeLinkHref(value: string): string | null {
    if (/[\s\u0000-\u001f\u007f<>"'`()[\]]/.test(value)) return null;
    const scheme = /^[a-z][a-z\d+\-.]*:/i.exec(value);
    if (scheme) return /^https?:/i.test(scheme[0]) ? value : null;
    return value.startsWith('/') && !value.startsWith('//') ? value : null;
}

/**
 * 将结构化会话（包含提问、深度思考思维链、回答、工具返回）序列化为规范的 GitHub-Flavored Markdown 文本
 */
export function formatConversationMarkdown(options: ExportConversationOptions): string {
    const { title, labels, agentName, model, exportTime, messages } = options;
    // 四个字段都可能是非字符串（调用方传 any）或带换行，先统一折成可信的单行展示串
    const agent = toInlineText(agentName) || labels.agentDefault;
    const modelText = inlineCode(toInlineText(model) || labels.modelDefault);
    const docTitle = toInlineText(title) || labels.untitled;
    const time = toInlineText(exportTime) || new Date().toISOString();

    const lines: string[] = [];

    // 头部元信息
    lines.push(`# ${labels.doc}: ${docTitle}`);
    lines.push('');
    lines.push(`- **${labels.agent}**: ${agent}`);
    lines.push(`- **${labels.model}**: ${modelText}`);
    lines.push(`- **${labels.exportedAt}**: ${time}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const msg of messages) {
        if (!msg) continue;
        const roleHeader = msg.role === 'user' ? `### 👤 ${labels.user}` : `### 🤖 ${agent}`;
        lines.push(roleHeader);
        lines.push('');

        if (Array.isArray(msg.parts) && msg.parts.length > 0) {
            for (const part of msg.parts) {
                // part 来自聊天客户端状态（未经服务端 schema 约束），text/reasoning 未必是字符串
                const partText = typeof part.text === 'string' ? part.text : '';
                if (part.type === 'reasoning') {
                    const reasoningText = (typeof part.reasoning === 'string' ? part.reasoning : partText).trim();
                    if (reasoningText) {
                        lines.push(`> 💭 **${labels.reasoning}**:`);
                        for (const rLine of reasoningText.split('\n')) {
                            lines.push(`> ${rLine}`);
                        }
                        lines.push('');
                    }
                } else if (part.type === 'text') {
                    if (partText.trim()) {
                        lines.push(partText.trim());
                        lines.push('');
                    }
                } else if (part.type === 'file' || part.type === 'image') {
                    // 附件在导出里保留可点击链接，否则导出的记录会丢失用户发过的文件；
                    // 链接目标不可信时只留文件名，宁缺链也不把可执行/超长地址写进文档
                    const filePart = part as { url?: unknown; filename?: unknown };
                    const rawUrl = typeof filePart.url === 'string' ? filePart.url.trim() : '';
                    if (!rawUrl) continue;
                    const name = inlineCode(toInlineText(filePart.filename) || labels.attachment);
                    const href = safeLinkHref(rawUrl);
                    lines.push(href ? `📎 **${name}**: [${labels.open}](${href})` : `📎 **${name}**`);
                    lines.push('');
                } else if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
                    const toolName = toInlineText(part.toolName) || toInlineText(part.type.slice('tool-'.length));
                    lines.push(`> 🛠️ **${labels.toolCall}** (${inlineCode(toolName)}):`);
                    if (part.output) {
                        const jsonStr = typeof part.output === 'string' ? part.output : JSON.stringify(part.output, null, 2);
                        const fence = '`'.repeat(Math.max(3, backtickRun(jsonStr) + 1));
                        lines.push(`> ${fence}json`);
                        for (const jLine of jsonStr.split('\n')) {
                            lines.push(`> ${jLine}`);
                        }
                        lines.push(`> ${fence}`);
                    }
                    lines.push('');
                }
            }
        } else if (typeof msg.content === 'string' && msg.content.trim()) {
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
