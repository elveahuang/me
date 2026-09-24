import { count, desc, eq, gte } from 'drizzle-orm';
import { agents, conversations, knowledgeBases, mcpServers, membershipPlans, messages, orders, providers, skills, tools, user } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
        [userCount],
        [agentCount],
        [conversationCount],
        [skillCount],
        [toolCount],
        [providerCount],
        [mcpCount],
        [kbCount],
        [planCount],
        [orderCount],
        [messageCount],
        [activeConversations],
    ] = await Promise.all([
        db.select({ value: count() }).from(user),
        db.select({ value: count() }).from(agents),
        db.select({ value: count() }).from(conversations),
        db.select({ value: count() }).from(skills),
        db.select({ value: count() }).from(tools),
        db.select({ value: count() }).from(providers),
        db.select({ value: count() }).from(mcpServers),
        db.select({ value: count() }).from(knowledgeBases),
        db.select({ value: count() }).from(membershipPlans),
        db.select({ value: count() }).from(orders),
        db.select({ value: count() }).from(messages),
        db.select({ value: count() }).from(conversations).where(gte(conversations.updatedAt, dayAgo)),
    ]);

    const recentUsers = await db
        .select({ id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt })
        .from(user)
        .orderBy(desc(user.createdAt))
        .limit(5);

    const recentConversations = await db
        .select({
            id: conversations.id,
            title: conversations.title,
            agentName: agents.name,
            agentEmoji: agents.emoji,
            updatedAt: conversations.updatedAt,
        })
        .from(conversations)
        .innerJoin(agents, eq(conversations.agentId, agents.id))
        .orderBy(desc(conversations.updatedAt))
        .limit(5);

    const modelUsage = await db
        .select({ model: agents.model, value: count(conversations.id) })
        .from(conversations)
        .innerJoin(agents, eq(conversations.agentId, agents.id))
        .groupBy(agents.model)
        .orderBy(desc(count(conversations.id)));

    return {
        users: Number(userCount?.value ?? 0),
        agents: Number(agentCount?.value ?? 0),
        conversations: Number(conversationCount?.value ?? 0),
        skills: Number(skillCount?.value ?? 0),
        tools: Number(toolCount?.value ?? 0),
        providers: Number(providerCount?.value ?? 0),
        mcpServers: Number(mcpCount?.value ?? 0),
        knowledgeBases: Number(kbCount?.value ?? 0),
        plans: Number(planCount?.value ?? 0),
        orders: Number(orderCount?.value ?? 0),
        messages: Number(messageCount?.value ?? 0),
        activeConversations24h: Number(activeConversations?.value ?? 0),
        recentUsers,
        recentConversations,
        modelUsage: modelUsage.map((r) => ({ model: r.model, conversations: Number(r.value) })),
    };
});
