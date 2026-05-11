import { version } from '@/core/utils';
import { Tool, tool } from 'ai';
import dayjs from 'dayjs';
import { z } from 'zod';

export const greetingInputSchema = z.object({
    name: z.string(),
});

export type GreetingInput = z.infer<typeof greetingInputSchema>;

export const greetingTool: Tool<GreetingInput, string> = tool({
    description: '问好',
    inputSchema: greetingInputSchema,
    outputSchema: z.string(),
    execute: async (params: GreetingInput): Promise<string> => {
        return `你好呀，${params.name}。`;
    },
});

export const dateInputSchema = z.object({});

export type DateInput = z.infer<typeof dateInputSchema>;

export const dateTool: Tool<DateInput, string> = tool({
    description: '获取当前日期',
    inputSchema: dateInputSchema,
    outputSchema: z.string(),
    execute: async (): Promise<string> => {
        return `${dayjs().format('YYYY-MM-DD')}`;
    },
});

export const versionInputSchema = z.object({});

export type VersionInput = z.infer<typeof versionInputSchema>;

export const versionTool: Tool<VersionInput, string> = tool({
    description: '获取版本号',
    inputSchema: versionInputSchema,
    outputSchema: z.string(),
    execute: async (): Promise<string> => {
        return version;
    },
});
