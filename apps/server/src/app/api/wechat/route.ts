import logger from '@/core/utils/logger';
import { openai } from '@ai-sdk/openai';
import { streamText, StreamTextResult, ToolSet } from 'ai';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
    const requestUrl = new URL(req.url);
    const id: string | null = requestUrl.searchParams.get('id');
    logger.info(`Chat Start -  ${req.url} - ${id}`);
    logger.info(`Chat Start -  ${req.url} - ${req.nextUrl.searchParams.get('id')}`);
    return NextResponse.json({ status: 200, now: Date.now() });
}

export async function POST(req: Request): Promise<Response> {
    logger.info(`Chat Start -  ${req.url}`);
    const { messages, prompt } = (await req.json()) as { messages: []; prompt: string };
    logger.info(`Chat Start prompt - ${prompt}`);
    const result: StreamTextResult<ToolSet, never> = streamText({
        model: openai('gpt-4-turbo'),
        messages,
    });
    return result.toUIMessageStreamResponse();
}
