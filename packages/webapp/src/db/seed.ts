import { db } from './index';
import { messages } from './schema';

const SAMPLE_MESSAGES = ['Hello from TanStack Start'];

async function seed() {
    await db.insert(messages).values(
        SAMPLE_MESSAGES.map((text) => ({
            text,
        })),
    );
    console.log('Seeded database successfully');
    process.exit(0);
}

seed().catch((err) => {
    console.error('Failed to seed database:', err);
    process.exit(1);
});
