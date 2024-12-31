/**
 * 接口响应数据
 */
export class R<T = any> {
    code?: number | string;
    message?: string;
    data?: T;
}

/**
 * 分页请求接口响应数据
 */
export class PageResponse<T = any> {
    content?: T[];
    totalElements?: number | string;
    pageable?: {
        pageNumber?: number;
        pageSize?: number;
    };
    last?: boolean;
}

export class PageResult<T = any> extends PageResponse<T> {}

/**
 * 分页请求参数
 */
export class PageRequest {
    page?: number;
    size?: number;
    sort?: string;
    order?: string;
    q?: string;

    [key: string]: unknown;
}

export class PageParams extends PageRequest {}

/**
 * 实体主键
 */
export type Key = string | number | bigint;

export class DeleteRequest {
    ids?: Key[];
}

export class DeleteParams extends DeleteRequest {}

export class DetailsRequest {
    id: Key;
}

export class DetailsParams extends DetailsRequest {}

export class CheckCodeRequest {
    id?: Key;
    code?: string;
}

export class CheckCodeParams extends CheckCodeRequest {}
