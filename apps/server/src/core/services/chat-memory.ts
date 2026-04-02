import { getPayload } from '@/payload/utils';
import { ChatMemory } from '@payload-types';
import { ModelMessage } from 'ai';
import { BasePayload, PaginatedDocs } from 'payload';

export class ChatMemoryService {
    async findByConversationId(conversationId: string = ''): Promise<ModelMessage[]> {
        const payload: BasePayload = await getPayload();
        const items: PaginatedDocs<ChatMemory> = await payload.find({
            collection: 'chat-memory',
            depth: 1,
            limit: 12,
            overrideAccess: false,
            where: {
                conversationId: { equals: conversationId },
            },
        });
        return items.docs.map((item: ChatMemory) => {
            return {
                role: item.type,
                content: JSON.parse(item.content),
            };
        }) as ModelMessage[];
    }

    async deleteByConversationId(conversationId: string = ''): Promise<void> {
        const payload: BasePayload = await getPayload();
        await payload.delete({
            collection: 'chat-memory',
            where: {
                conversationId: { equals: conversationId },
            },
            depth: 0,
            fallbackLocale: false,
            overrideAccess: true,
            overrideLock: false,
            showHiddenFields: true,
        });
    }

    async save(conversationId: string, messages: ModelMessage[] = []): Promise<void> {
        // 先删除已有记录
        await this.deleteByConversationId(conversationId);
        // 保存新记录
        const payload: BasePayload = await getPayload();
        const items: ChatMemory[] = messages.map((message) => {
            return {
                conversationId: conversationId,
                type: message.role,
                content: JSON.stringify(message.content),
            } as ChatMemory;
        });
        for (const item of items) {
            await payload.create({
                collection: 'chat-memory',
                data: item,
                depth: 0,
                fallbackLocale: false,
                overrideAccess: true,
                showHiddenFields: true,
            });
        }
    }
}

export function getChatMemoryService(): ChatMemoryService {
    return new ChatMemoryService();
}
