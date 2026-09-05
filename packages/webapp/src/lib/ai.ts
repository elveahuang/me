import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

/**
 * 模型标识格式："provider:model"，如
 *  - "deepseek:deepseek-chat"
 *  - "openai:gpt-4o-mini"
 */
export const MODEL_PRESETS = [
    { id: 'deepseek:deepseek-chat', label: 'DeepSeek Chat' },
    { id: 'openai:gpt-4o-mini', label: 'OpenAI GPT-4o mini' },
    { id: 'openai:gpt-4.1-mini', label: 'OpenAI GPT-4.1 mini' },
] as const;

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });

export function hasAnyAiKey() {
    return Boolean(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY);
}

/** 内置环境变量型供应商的模型可用性校验（自定义供应商走 providers 表，另行校验） */
export function ensureBuiltinModelAvailable(id: string) {
    const separator = id.indexOf(':');
    const provider = separator === -1 ? id : id.slice(0, separator);
    if (provider === 'deepseek' && !process.env.DEEPSEEK_API_KEY) {
        throw new Error('DEEPSEEK_API_KEY 未配置');
    }
    if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY 未配置');
    }
}

export function resolveModel(id: string): LanguageModel {
    const separator = id.indexOf(':');
    const provider = separator === -1 ? id : id.slice(0, separator);
    const modelId = separator === -1 ? '' : id.slice(separator + 1);

    switch (provider) {
        case 'openai':
            return openai(modelId || 'gpt-4o-mini');
        case 'deepseek':
            return deepseek(modelId || 'deepseek-chat');
        default:
            throw new Error(`未知的模型提供方: ${id}`);
    }
}

/** 用自定义供应商（OpenAI 兼容协议）解析模型 */
export function resolveProviderModel(provider: { protocol: string; baseUrl: string; apiKey: string }, modelId: string): LanguageModel {
    if (provider.protocol === 'deepseek') {
        const instance = createDeepSeek({ baseURL: provider.baseUrl, apiKey: provider.apiKey });
        return instance(modelId);
    }
    const instance = createOpenAI({ baseURL: provider.baseUrl, apiKey: provider.apiKey });
    return instance(modelId);
}
