import { messages } from '@schema';
import { defineHandler, type InferProps } from 'void';
import { db, desc } from 'void/db';

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async () => {
    const rows = await db.select().from(messages).orderBy(desc(messages.id));
    return { messages: rows };
});
