import { asc, eq } from 'drizzle-orm';
import { agentSkills, agents, skills } from '../db/schema';
import { db } from '../utils/db';
import { requireUser } from '../utils/guard';

export default defineEventHandler(async (event) => {
    await requireUser(event);

    const rows = await db
        .select({
            id: agents.id,
            name: agents.name,
            emoji: agents.emoji,
            avatar: agents.avatar,
            description: agents.description,
        })
        .from(agents)
        .where(eq(agents.enabled, true))
        .orderBy(asc(agents.createdAt));

    const withSkills = await Promise.all(
        rows.map(async (agent) => {
            const bound = await db
                .select({ id: skills.id, name: skills.name })
                .from(agentSkills)
                .innerJoin(skills, eq(skills.id, agentSkills.skillId))
                .where(eq(agentSkills.agentId, agent.id));
            return { ...agent, skills: bound };
        }),
    );
    return withSkills;
});
