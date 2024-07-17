export class R<T = any> {
    code?: number | string;
    message?: string;
    data?: T;
}

export class Page<T> {
    content?: T[];
    totalElements?: number | string;
    pageable?: {
        pageNumber?: number;
        pageSize?: number;
    };
}

export type EntityKey = string;

export class Pagination {
    readonly page?: number = 1;
    readonly size?: number = 12;
    readonly q?: string = '';
}

export class PaginationQuery extends Pagination {}

export const defaultPagination: Pagination = {
    page: 1,
    size: 12,
};

export class DeleteQuery {
    ids: number[] | string[] | bigint[] | EntityKey[];
}
