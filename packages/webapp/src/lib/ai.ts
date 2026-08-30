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
