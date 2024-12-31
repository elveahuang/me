import { R } from '@commons/core/types';
import { get } from '@commons/core/utils/http';

export class HomeApiResult {
    access_token: string;
    refresh_token: string;
}

export const homeApi = (): Promise<R<HomeApiResult>> => {
    return get<R<HomeApiResult>>('/api/home', {});
};
