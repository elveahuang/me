import { R } from '@commons/core/types';
import { get } from '@commons/core/utils/http';

export class InitializeApiResult {
    //
}

export const initializeApi = (): Promise<R<InitializeApiResult>> => {
    return get<R<InitializeApiResult>>('/api/initialize');
};
