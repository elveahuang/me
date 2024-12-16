import { Key, PageParams, PageResult, R, User } from '@commons/core/types';
import { post } from '@commons/core/utils/http';

// ---------------------------------------------------------------------------------------------------------------------
// 获取用户列表
// ---------------------------------------------------------------------------------------------------------------------
export interface UserListApiResult extends PageResult<User> {}

export interface UserApiParams extends PageParams {}

export const userListApi = (params: UserApiParams): Promise<R<UserListApiResult>> => {
    return post<R<UserListApiResult>>('/api/admin/user/list', params);
};

// ---------------------------------------------------------------------------------------------------------------------
// 获取公告资讯详情
// ---------------------------------------------------------------------------------------------------------------------
export interface UserDetailsApiParams {
    id: number;
}

export const userDetailsApi = (params: UserDetailsApiParams): Promise<R<User>> => {
    return post<R<User>>('/api/admin/user/details', params);
};

// ---------------------------------------------------------------------------------------------------------------------
// 保存用户
// ---------------------------------------------------------------------------------------------------------------------
export const userSaveApi = (params: User): Promise<R<string>> => {
    return post<R<string>>('/api/admin/user/save', params);
};

// ---------------------------------------------------------------------------------------------------------------------
// 删除用户
// ---------------------------------------------------------------------------------------------------------------------
export interface UserDeleteApiParams {
    ids?: Key[];
}

export const userDeleteApi = (params: UserDeleteApiParams): Promise<R<string>> => {
    return post<R<string>>('/api/admin/user/delete', params);
};
