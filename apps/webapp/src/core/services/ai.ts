import env from '@/core/env';
import { createDeepSeek, DeepSeekProvider } from '@ai-sdk/deepseek';
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';
import { LanguageModel } from 'ai';

export type PROVIDER = 'deepseek' | 'openai';

export class AIService {
    public model(provider: PROVIDER = 'deepseek'): LanguageModel {
        switch (provider) {
            case 'openai':
                return this.openai();
            default:
                return this.deepseek();
        }
    }

    public deepseek(): LanguageModel {
        const deepseek: DeepSeekProvider = createDeepSeek({
            apiKey: env.ai.deepseek.apiKey,
        });
        return deepseek('deepseek-chat');
    }

    public openai(): LanguageModel {
        const openai: OpenAIProvider = createOpenAI({
            baseURL: env.ai.openai.baseURL,
            apiKey: env.ai.openai.apiKey,
        });
        return openai('deepseek-r1');
    }
}

export function getAIService(): AIService {
    return new AIService();
}
