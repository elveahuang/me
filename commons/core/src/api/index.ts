import { R } from '@commons/core/types';
import { post } from '@commons/core/utils/http';

export class InitializeApiResult {
    //
}

export const initializeApi = (): Promise<R<InitializeApiResult>> => {
    return post<R<InitializeApiResult>>('/api/v1/initialize');
};
