import type { CollectionConfig } from 'payload';

export const ChatMemory: CollectionConfig = {
    slug: 'chat-memory',
    access: {
        read: () => true,
    },
    fields: [
        {
            name: 'conversationId',
            type: 'text',
            required: true,
        },
        {
            name: 'type',
            type: 'text',
            required: true,
        },
        {
            name: 'content',
            type: 'text',
            required: true,
        },
    ],
};
