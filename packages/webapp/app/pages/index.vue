<script setup lang="ts">
import type { AgentSummary } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import { fetchSession, ssrCookieHeaders } from '~/utils/auth-client';

const { t } = useI18n();
const session = await fetchSession(ssrCookieHeaders());

const { data: agents } = await useFetch<AgentSummary[]>('/api/agents');

const features = computed(() => [
    {
        icon: '🧠',
        title: '深度思考与多模型调度',
        titleEn: 'Deep Reasoning & Multi-Model Routing',
        desc: '支持 DeepSeek-R1、OpenAI o-series、Claude 3.5 与自建中转网关，动态光晕思维链折叠展开。',
        descEn: 'Support DeepSeek, OpenAI, Claude and custom gateways with dynamic reasoning visualization.',
        tag: 'Reasoning Stream',
    },
    {
        icon: '📚',
        title: '高可用双模 RAG 知识库',
        titleEn: 'High-Availability Dual-Mode RAG',
        desc: '向量检索深度融合 Bigram 关键词分词兜底算法。API 异常时自动秒级降级，检索永不中断。',
        descEn: 'Embedding vector retrieval backed by Bigram text matching for zero-downtime search.',
        tag: 'Dual RAG',
    },
    {
        icon: '🛠️',
        title: '工具增强与 Generative UI',
        titleEn: 'Tool Augmented & Generative UI',
        desc: '原生支持天气卡片、任务清单勾选、ECharts 图表与 MCP 协议生态，生成式交互开箱即用。',
        descEn: 'Native weather cards, interactive checklists, ECharts visualizations and MCP servers.',
        tag: 'MCP & Skills',
    },
    {
        icon: '💳',
        title: '多阶会员与原子计费控制',
        titleEn: 'Multi-Tier Plans & Atomic Quotas',
        desc: '内置 Free/Pro/Max 三阶会员方案，支持微信扫码与模拟测试通道，严格行级事务锁防止并发超刷。',
        descEn: 'Free/Pro/Max tiers with WeChat and mock sandbox pay, backed by advisory transaction locks.',
        tag: 'Quota & Billing',
    },
]);
</script>

<template>
    <div class="space-y-14 py-6">
        <BulletinBanner position="home" />

        <!-- Hero 主视觉 -->
        <section class="app-card relative overflow-hidden p-8 text-center sm:p-14">
            <div class="bg-brand-soft-gradient pointer-events-none absolute inset-0 opacity-70" />
            <div class="relative">
                <div class="app-chip app-chip-brand mx-auto px-4 py-1.5 text-[11px] font-bold">
                    <span>🚀</span>
                    <span>Next-Gen Enterprise Multi-Agent Platform</span>
                </div>

                <h1 class="mt-6 text-3xl font-black tracking-tight sm:text-5xl lg:text-6xl">
                    让专属智能体成为你的
                    <span class="text-brand"> 高效数字助理 </span>
                </h1>

                <p class="text-muted-2 mx-auto mt-4 max-w-2xl text-xs leading-relaxed sm:text-sm">
                    基于 Nuxt 4 服务端与 Ionic 移动端同构生态。融合大模型流式推理、离线高可用 RAG 知识库检索、MCP 协议工具扩展与全景多阶会员体系。
                </p>

                <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <template v-if="session">
                        <NuxtLink to="/chat" class="app-btn app-btn-primary !px-6 !py-3 sm:!text-sm"> {{ t('nav.agents') }} → </NuxtLink>
                        <NuxtLink to="/profile" class="app-btn app-btn-outline !px-5 !py-3 sm:!text-sm">
                            {{ t('nav.profile') }}
                        </NuxtLink>
                    </template>
                    <template v-else>
                        <NuxtLink to="/login" class="app-btn app-btn-primary !px-6 !py-3 sm:!text-sm"> {{ t('nav.login') }} → </NuxtLink>
                        <NuxtLink to="/register" class="app-btn app-btn-outline !px-5 !py-3 sm:!text-sm">
                            {{ t('nav.register') }}
                        </NuxtLink>
                        <NuxtLink to="/pricing" class="app-btn app-btn-soft !px-4 !py-3 sm:!text-sm"> 💎 {{ t('nav.pricing') }} </NuxtLink>
                    </template>
                </div>

                <!-- 平台关键指标 -->
                <div class="app-divider mt-12 grid grid-cols-2 gap-4 pt-8 sm:grid-cols-4">
                    <div>
                        <div class="text-2xl font-black">4+</div>
                        <div class="text-faint mt-0.5 text-xs">主流模型驱动</div>
                    </div>
                    <div>
                        <div class="text-brand text-2xl font-black">100%</div>
                        <div class="text-faint mt-0.5 text-xs">离线双模检索</div>
                    </div>
                    <div>
                        <div class="text-2xl font-black">&lt; 10ms</div>
                        <div class="text-faint mt-0.5 text-xs">滑动窗口限流</div>
                    </div>
                    <div>
                        <div class="text-soft text-2xl font-black">Web + Native</div>
                        <div class="text-faint mt-0.5 text-xs">多端无缝协同</div>
                    </div>
                </div>
            </div>
        </section>

        <!-- 四大核心支柱 -->
        <section class="space-y-6">
            <div class="text-center">
                <h2 class="text-2xl font-black tracking-tight">全栈工程化架构能力</h2>
                <p class="text-faint mt-1 text-xs">为生产级 AI 智能体应用量身定制的技术底座</p>
            </div>

            <div class="grid gap-5 sm:grid-cols-2">
                <div v-for="f in features" :key="f.title" class="app-card app-card-hover p-6 sm:p-7">
                    <div class="flex items-center justify-between">
                        <span class="text-3xl">{{ f.icon }}</span>
                        <span class="app-chip font-mono text-[10px] font-bold">{{ f.tag }}</span>
                    </div>
                    <h3 class="mt-4 text-base font-black">{{ f.title }}</h3>
                    <p class="text-muted-2 mt-2 text-xs leading-relaxed">{{ f.desc }}</p>
                </div>
            </div>
        </section>

        <!-- 智能体橱窗快速预览 -->
        <section v-if="agents?.length" class="space-y-6">
            <div class="flex items-center justify-between">
                <div>
                    <h2 class="text-2xl font-black tracking-tight">{{ t('agents.title') }}</h2>
                    <p class="text-faint text-xs">{{ t('agents.subtitle') }}</p>
                </div>
                <NuxtLink to="/chat" class="app-link text-xs"> {{ t('common.all') }} → </NuxtLink>
            </div>

            <div class="grid gap-4 sm:grid-cols-3">
                <NuxtLink v-for="agent in agents.slice(0, 3)" :key="agent.id" :to="`/chat/${agent.id}`" class="app-card app-card-hover group p-6">
                    <div class="flex items-center gap-3">
                        <div class="app-avatar-icon h-11 w-11 text-2xl transition-transform group-hover:scale-105">
                            {{ agent.emoji || agent.avatar || '🤖' }}
                        </div>
                        <div class="min-w-0 flex-1">
                            <h4 class="group-hover:text-brand truncate text-sm font-black transition-colors">
                                {{ agent.name }}
                            </h4>
                            <p class="text-faint truncate text-[11px]">{{ agent.description || t('common.none') }}</p>
                        </div>
                    </div>
                    <div v-if="agent.skills?.length" class="app-divider mt-4 flex flex-wrap gap-1.5 pt-2">
                        <span v-for="s in agent.skills.slice(0, 3)" :key="s.id" class="app-chip text-[10px]">
                            {{ s.name }}
                        </span>
                    </div>
                </NuxtLink>
            </div>
        </section>
    </div>
</template>
