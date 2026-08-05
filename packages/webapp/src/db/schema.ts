import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const messages = pgTable('messages', {
    id: serial('id').primaryKey(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
});
