import { Key, R } from '@commons/core/types';
import { post } from '@commons/core/utils/http';

/**
 * 检测用户名是否可用
 */
export interface CheckUsernameApiParams {
    username?: string;
    id?: Key;
}

export const checkUsernameApi = (params: CheckUsernameApiParams): Promise<R<boolean>> => {
    return post<R<boolean>>('/api/user/check/username', params);
};
