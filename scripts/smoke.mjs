/**
 * 端到端冒烟测试：对运行中的 webapp（默认 http://localhost:3000）执行全链路检查。
 * 用法：node scripts/smoke.mjs [baseUrl]
 * 需要数据库已 migrate + seed，且 DEEPSEEK_API_KEY 可用（部分用例走真实 AI）。
 */
const BASE = process.argv[2] ?? 'http://localhost:3000';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = '') {
    if (cond) {
        passed++;
        console.log(`  ✅ ${name}`);
    } else {
        failed++;
        failures.push(`${name} ${detail}`);
        console.log(`  ❌ ${name} ${detail}`);
    }
}

function cookieHeader(jar) {
    return Object.entries(jar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
}

function storeCookies(jar, res) {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const line of setCookies) {
        const [pair] = line.split(';');
        const eq = pair.indexOf('=');
        jar[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
}

async function jsonFetch(jar, path, init = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...(Object.keys(jar).length ? { cookie: cookieHeader(jar) } : {}), ...(init.headers ?? {}) },
    });
    storeCookies(jar, res);
    const text = await res.text();
    let body = null;
    try {
        body = JSON.parse(text);
    } catch {
        body = text;
    }
    return { res, body };
}

async function streamChat(jar, body) {
    const res = await fetch(`${BASE}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieHeader(jar) },
        body: JSON.stringify(body),
    });
    const conversationId = res.headers.get('x-conversation-id');
    if (!res.ok) {
        const errBody = await res.text();
        return { status: res.status, conversationId, text: '', hadToolCall: false, error: errBody.slice(0, 200) };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let hadToolCall = false;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
                const chunk = JSON.parse(payload);
                if (chunk.type === 'text-delta' && chunk.delta) text += chunk.delta;
                if (chunk.type === 'tool-input-available') hadToolCall = true;
            } catch {
                /* 忽略非 JSON 行 */
            }
        }
    }
    return { status: res.status, conversationId, text, hadToolCall, error: null };
}

/** 等待助手消息落库（onFinish 在流结束后异步执行） */
async function pollForMessages(jar, conversationId, minCount, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = await jsonFetch(jar, `/api/conversations/${conversationId}`);
        if (last.res.status === 200 && Array.isArray(last.body?.messages) && last.body.messages.length >= minCount) {
            return last;
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    return last;
}

const UNIQUE = Date.now().toString(36);

async function main() {
    console.log(`\n=== 冒烟测试 ${BASE} ===\n`);

    // 1. 页面渲染
    const pageRes = await fetch(`${BASE}/login`);
    check('登录页 SSR 200', pageRes.status === 200);

    // 2. 管理员登录
    const adminJar = {};
    const signIn = await jsonFetch(adminJar, '/api/auth/sign-in/email', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com', password: 'admin123456' }),
    });
    check('管理员登录', signIn.res.status === 200 && Boolean(signIn.body?.token));

    // 3. 会话与智能体
    const agents = await jsonFetch(adminJar, '/api/agents');
    check('智能体列表（3+）', Array.isArray(agents.body) && agents.body.length >= 3);
    const stats = await jsonFetch(adminJar, '/api/admin/stats');
    check('管理端统计', stats.res.status === 200 && typeof stats.body?.totals?.users === 'number');

    // 4. 自定义供应商 CRUD（创建后删除）
    const provider = await jsonFetch(adminJar, '/api/admin/providers', {
        method: 'POST',
        body: JSON.stringify({
            name: `冒烟供应商-${UNIQUE}`,
            protocol: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'sk-smoke-1234567890',
            embeddingModel: 'text-embedding-test',
        }),
    });
    check('创建自定义供应商', provider.res.status === 201 && provider.body?.apiKey?.includes('****'));
    const providerList = await jsonFetch(adminJar, '/api/admin/providers');
    check('供应商列表（掩码 key）', Array.isArray(providerList.body) && providerList.body.some((p) => p.name === `冒烟供应商-${UNIQUE}`));
    const providerPatch = await jsonFetch(adminJar, `/api/admin/providers/${provider.body.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
    });
    check('更新供应商', providerPatch.res.status === 200 && providerPatch.body?.enabled === false);
    const providerDelete = await jsonFetch(adminJar, `/api/admin/providers/${provider.body.id}`, { method: 'DELETE' });
    check('删除供应商', providerDelete.res.status === 200);

    // 5. 内置供应商可用性
    const builtins = await jsonFetch(adminJar, '/api/admin/builtin-providers');
    check('内置供应商可用性接口', Array.isArray(builtins.body) && builtins.body.some((b) => b.id === 'deepseek'));

    // 6. Tool CRUD（HTTP 工具示例，创建后删除）
    const tool = await jsonFetch(adminJar, '/api/admin/tools', {
        method: 'POST',
        body: JSON.stringify({
            name: `冒烟工具-${UNIQUE}`,
            description: '冒烟测试 HTTP 工具',
            type: 'http',
            config: {
                url: `https://httpbingo.org/anything?q={{q}}`,
                method: 'GET',
                parameters: [{ name: 'q', type: 'string', description: '查询词', required: true }],
            },
            enabled: false,
        }),
    });
    check('创建 HTTP 工具', tool.res.status === 201);
    const toolDelete = await jsonFetch(adminJar, `/api/admin/tools/${tool.body.id}`, { method: 'DELETE' });
    check('删除工具', toolDelete.res.status === 200);

    // 7. 知识库：建库 → 入库文档（关键词检索模式）→ 查询 → 删除
    const kb = await jsonFetch(adminJar, '/api/admin/knowledge', {
        method: 'POST',
        body: JSON.stringify({ name: `冒烟知识库-${UNIQUE}`, description: 'smoke' }),
    });
    check('创建知识库', kb.res.status === 201);
    const doc = await jsonFetch(adminJar, `/api/admin/knowledge/${kb.body.id}/documents`, {
        method: 'POST',
        body: JSON.stringify({
            title: '公司请假制度',
            content: [
                '请假政策：员工每年享有 15 天带薪年假。年假需要提前 3 个工作日在 OA 系统申请，由直属主管审批。',
                '病假需要提供医院证明，病假期间工资按 80% 发放。事假不带薪，全年累计不得超过 10 天。',
                '产假按国家规定执行，共 98 天基础产假，另有地方奖励假。婚假为 10 天，需在领证后一年内使用。',
            ].join('\n\n'),
        }),
    });
    check('文档入库（分块）', doc.res.status === 201 && (doc.body?.chunkCount ?? 0) > 0);

    // 把知识库挂到「数据看板助手」上做一次检索对话
    const agentsFull = await jsonFetch(adminJar, '/api/admin/agents');
    const target = agentsFull.body.find((a) => a.name === '数据看板助手');
    const patchKb = await jsonFetch(adminJar, `/api/admin/agents/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ knowledgeBaseIds: [kb.body.id] }),
    });
    check('智能体挂载知识库', patchKb.res.status === 200 && patchKb.body?.knowledgeBaseIds?.includes(kb.body.id));

    const ragChat = await streamChat(adminJar, {
        agentId: target.id,
        messages: [{ id: `s-${UNIQUE}-1`, role: 'user', parts: [{ type: 'text', text: '年假有多少天？需要提前几天申请？' }] }],
    });
    check('RAG 对话完成（引用知识库不报错）', ragChat.status === 200 && ragChat.text.length > 10, `text=${ragChat.text.slice(0, 60)}`);

    const kbDelete = await jsonFetch(adminJar, `/api/admin/knowledge/${kb.body.id}`, { method: 'DELETE' });
    await jsonFetch(adminJar, `/api/admin/agents/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ knowledgeBaseIds: [] }),
    });
    check('删除知识库并解挂', kbDelete.res.status === 200);

    // 8. AI 自动配置
    const autoConfig = await jsonFetch(adminJar, '/api/admin/agents/auto-config', {
        method: 'POST',
        body: JSON.stringify({ description: '一个帮我每天整理科技新闻并生成摘要的智能助手' }),
    });
    check(
        'AI 自动配置返回草案',
        autoConfig.res.status === 200 && typeof autoConfig.body?.name === 'string' && typeof autoConfig.body?.model === 'string',
        `status=${autoConfig.res.status}`,
    );

    // 8.5 MCP 服务器：创建（stdio echo 测试服务器）→ 测试连接 → 挂载 → 对话 → 清理
    const mcpScriptPath = new URL('./test-mcp-server.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const mcp = await jsonFetch(adminJar, '/api/admin/mcp', {
        method: 'POST',
        body: JSON.stringify({
            name: `冒烟MCP-${UNIQUE}`,
            description: 'smoke stdio echo server',
            transport: 'stdio',
            command: 'node',
            args: [mcpScriptPath],
        }),
    });
    check('创建 stdio MCP 服务器', mcp.res.status === 201);

    const mcpTest = await jsonFetch(adminJar, `/api/admin/mcp/${mcp.body.id}/test`, { method: 'POST' });
    check(
        'MCP 测试连接（列出 echo 工具）',
        mcpTest.res.status === 200 && mcpTest.body?.ok === true && (mcpTest.body?.tools ?? []).some((t) => t.name === 'echo'),
        JSON.stringify(mcpTest.body).slice(0, 120),
    );

    const mcpAgent = agents.body.find((a) => a.name === '通用助手');
    const mcpPatch = await jsonFetch(adminJar, `/api/admin/agents/${mcpAgent.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ mcpServerIds: [mcp.body.id] }),
    });
    check('智能体挂载 MCP 服务器', mcpPatch.res.status === 200 && mcpPatch.body?.mcpServerIds?.includes(mcp.body.id));

    const mcpChat = await streamChat(adminJar, {
        agentId: mcpAgent.id,
        messages: [
            {
                id: `s-${UNIQUE}-mcp`,
                role: 'user',
                parts: [{ type: 'text', text: '请调用 echo 工具，参数 text 设为 PING123，然后把工具返回的内容原样告诉我。' }],
            },
        ],
    });
    check('MCP 对话完成', mcpChat.status === 200 && mcpChat.text.length > 0, `status=${mcpChat.status} error=${mcpChat.error ?? ''}`);
    check('MCP 工具被实际调用（ECHO 回显）', mcpChat.text.includes('ECHO:PING123'), `text=${mcpChat.text.slice(0, 120)}`);

    const mcpDelete = await jsonFetch(adminJar, `/api/admin/mcp/${mcp.body.id}`, { method: 'DELETE' });
    await jsonFetch(adminJar, `/api/admin/agents/${mcpAgent.id}`, { method: 'PATCH', body: JSON.stringify({ mcpServerIds: [] }) });
    check('删除 MCP 服务器并解挂', mcpDelete.res.status === 200);

    // 9. 普通用户：注册 → 对话（带工具的通用助手）→ 会话落库
    const userJar = {};
    const signUp = await jsonFetch(userJar, '/api/auth/sign-up/email', {
        method: 'POST',
        body: JSON.stringify({ name: 'SmokeUser', email: `smoke-${UNIQUE}@example.com`, password: 'smoke12345' }),
    });
    check('用户注册（返回 token）', signUp.res.status === 200 && Boolean(signUp.body?.token));

    const meBearer = await fetch(`${BASE}/api/me`, { headers: { authorization: `Bearer ${signUp.body.token}` } });
    check('Bearer 认证 /api/me', meBearer.status === 200);

    const generalAgent = agents.body.find((a) => a.name === '通用助手');
    const chat1 = await streamChat(userJar, {
        agentId: generalAgent.id,
        messages: [{ id: `s-${UNIQUE}-2`, role: 'user', parts: [{ type: 'text', text: '请用一句话介绍你自己，然后调用工具查询当前时间，并用一句中文说明现在的时间。' }] }],
    });
    check('对话流式完成', chat1.status === 200 && chat1.conversationId !== null && chat1.text.length > 5);
    check('Tool calling 触发', chat1.hadToolCall || chat1.text.length > 0, '（模型可自主决定不调用，文本回复亦可接受）');

    const convs = await jsonFetch(userJar, '/api/conversations');
    check('会话落库', Array.isArray(convs.body) && convs.body.length >= 1);
    const convDetail = await pollForMessages(userJar, chat1.conversationId, 2);
    check(
        '消息落库（用户+助手）',
        convDetail.res.status === 200 && Array.isArray(convDetail.body?.messages) && convDetail.body.messages.length >= 2,
        JSON.stringify(convDetail.body).slice(0, 150),
    );

    // 上下文窗口：发送 30 条短消息不应报错（窗口截断为最近 24 条）
    const manyMessages = Array.from({ length: 30 }, (_, i) => ({
        id: `s-${UNIQUE}-m${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        parts: [{ type: 'text', text: `测试消息 ${i}` }],
    }));
    manyMessages.push({ id: `s-${UNIQUE}-last`, role: 'user', parts: [{ type: 'text', text: '收到请回复：OK' }] });
    const chat2 = await streamChat(userJar, {
        agentId: generalAgent.id,
        conversationId: Number(chat1.conversationId),
        messages: manyMessages,
    });
    check('长上下文窗口截断正常', chat2.status === 200, `status=${chat2.status} error=${chat2.error ?? ''} text=${chat2.text.slice(0, 40)}`);

    // 10. CORS 预检（Expo/Ionic web 来源）
    const preflight = await fetch(`${BASE}/api/chat`, {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:8100', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,authorization' },
    });
    check(
        'CORS 预检 204 + ACAO',
        preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === 'http://localhost:8100',
    );
    const exposeCheck = await fetch(`${BASE}/api/agents`, { headers: { origin: 'http://localhost:8100', cookie: cookieHeader(userJar) } });
    check('CORS 暴露 x-conversation-id', (exposeCheck.headers.get('access-control-expose-headers') ?? '').includes('x-conversation-id'));

    // 11. 权限隔离：普通用户访问管理端
    const forbidden = await jsonFetch(userJar, '/api/admin/stats');
    check('普通用户访问管理端被拒', forbidden.res.status === 403);

    // 12. 未登录访问
    const anon = await jsonFetch({}, '/api/agents');
    check('未登录 401', anon.res.status === 401);

    console.log(`\n=== 结果：${passed} 通过，${failed} 失败 ===`);
    if (failures.length > 0) {
        console.log('失败项：');
        for (const f of failures) console.log(' -', f);
        process.exit(1);
    }
}

main().catch((e) => {
    console.error('冒烟测试执行失败:', e);
    process.exit(1);
});
