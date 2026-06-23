import { defineSeed } from 'void/seed';

const SAMPLE_MESSAGES = ['Hello from Void'];

export default defineSeed<typeof import('./schema')>(async ({ db, schema }) => {
    await db.insert(schema.messages).values(
        SAMPLE_MESSAGES.map((text) => ({
            text,
        })),
    );
});
