import { env } from '@commons/core/env';
import { ChatInit, TextStreamChatTransport, UIMessage, UseCompletionOptions } from 'ai';

export type PrepareRequestPayload = {
    body: object;
    headers?: HeadersInit;
    credentials?: RequestCredentials;
};

export type PrepareRequestOptions = {
    id: string;
    messages: UIMessage[];
    requestMetadata: unknown;
    body: Record<string, any> | undefined;
    credentials: RequestCredentials | undefined;
    headers: HeadersInit | undefined;
};

export const defaultUseChatOptions: ChatInit<UIMessage> = {
    transport: new TextStreamChatTransport({
        api: `${env.server}/api/v1/ai/chat`,
        prepareSendMessagesRequest: ({ messages, id }: PrepareRequestOptions): PrepareRequestPayload => {
            return {
                body: {
                    prompt: getText(messages[messages.length - 1]),
                    conversationId: id,
                },
            };
        },
    }),
};

export const defaultUseCompletionOptions: UseCompletionOptions = {
    api: `${env.server}/api/v1/ai/chat/completion`,
    streamProtocol: 'text',
};

export function getText(message: UIMessage): string {
    return message.parts.map((part): string => (part.type === 'text' ? part.text : '')).join('');
}
