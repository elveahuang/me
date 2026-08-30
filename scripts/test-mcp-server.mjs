/**
 * 测试用 stdio MCP 服务器：提供一个 echo 工具。
 * 供 smoke.mjs 验证平台的 MCP 集成（连接 → 列工具 → 调用）。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'echo-test-server', version: '1.0.0' });

server.registerTool(
    'echo',
    {
        description: '复读用户提供的文本（用于测试 MCP 集成）',
        inputSchema: { text: z.string().describe('要复读的文本') },
    },
    async ({ text }) => ({
        content: [{ type: 'text', text: `ECHO:${text}` }],
    }),
);

await server.connect(new StdioServerTransport());
