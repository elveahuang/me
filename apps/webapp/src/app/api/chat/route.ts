'use server';

import { getAIService } from '@/core/services/ai.ts';
import { getChatMemoryService } from '@/core/services/chat-memory.ts';
import { dateTool, greetingTool, versionTool } from '@/core/tools';
import { uuid } from '@/core/utils';
import logger from '@/core/utils/logger';
import { ModelMessage, smoothStream, streamText } from 'ai';
import { concat, isEmpty } from 'es-toolkit/compat';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
    const requestUrl = new URL(req.url);
    const conversationId: string | null = requestUrl.searchParams.get('conversationId');

    try {
        logger.info(`Chat Start -  ${req.url} - ${conversationId}`);
        if (isEmpty(conversationId)) {
            const data = {
                id: uuid(),
                messages: [],
            };
            return NextResponse.json(data);
        } else {
            const messages: ModelMessage[] = await getChatMemoryService().findByConversationId(conversationId as string);
            const data = {
                id: isEmpty(conversationId) ? uuid() : conversationId,
                messages: messages,
            };
            return NextResponse.json(data);
        }
    } catch (e) {
        logger.error(`Chat Start Error.`, e);
    }
    return NextResponse.json({});
}

export async function POST(req: Request) {
    try {
        logger.info(`AI Stream Request -  ${req.url}`);
        const { conversationId, prompt } = (await req.json()) as { conversationId: string; prompt: string };
        const previous: ModelMessage[] = await getChatMemoryService().findByConversationId(conversationId);
        logger.info(`AI stream - previous - ${JSON.stringify(previous)}`);
        const messages: ModelMessage[] = concat(previous, { role: 'user', content: prompt });
        logger.info(`AI stream - prompt - ${JSON.stringify(messages)}`);
        const system = '你是一个博学的智能聊天助手，请根据用户提问回答。\n请讲中文。';
        const stream = streamText({
            model: getAIService().model(),
            system,
            messages,
            tools: {
                getGreeting: greetingTool,
                getDate: dateTool,
                getVersion: versionTool,
            },
            experimental_transform: smoothStream({
                chunking: /[\u4E00-\u9FFF]|\S+\s+/,
            }),
            onFinish: async (result): Promise<void> => {
                logger.info(`AI stream - result - ${JSON.stringify(result)}`);
                messages.push(...result.response.messages);
                await getChatMemoryService().save(conversationId, messages);
                logger.info(`AI stream - messages - ${JSON.stringify(messages)}`);
            },
            onStepFinish: async (result): Promise<void> => {
                logger.info(`AI stream - onStepFinish - ${JSON.stringify(result.response.messages)}`);
            },
            onError: async (e): Promise<void> => {
                logger.info(`AI stream - onError - ${JSON.stringify(e)}`);
            },
        });
        return stream.toUIMessageStreamResponse();
    } catch (e) {
        logger.error(`AI stream - error`, e);
    }
    return NextResponse.json({});
}
