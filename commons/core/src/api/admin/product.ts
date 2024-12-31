import { PageParams, PageResult, R } from '@commons/core/types';
import { CheckCodeParams, DeleteParams, DetailsParams } from '@commons/core/types/common.ts';
import { Product } from '@commons/core/types/product';
import { post } from '@commons/core/utils/http';

/**
 * 获取产品列表
 */
export interface ProductListApiResult extends PageResult<Product> {}

export interface ProductListApiParams extends PageParams {}

export const productListApi = (params: ProductListApiParams): Promise<R<ProductListApiResult>> => {
    return post<R<ProductListApiResult>>('/api/admin/product/list', params);
};

/**
 * 获取产品详情
 */
export const productDetailsApi = (params: DetailsParams): Promise<R<Product>> => {
    return post<R<Product>>('/api/admin/product/details', params);
};

/**
 * 检测编号是否可用
 */
export const productCheckCodeApi = (params: CheckCodeParams): Promise<R<boolean>> => {
    return post<R<boolean>>('/api/admin/product/check/code', params);
};

/**
 * 保存产品
 */
export const productSaveApi = (params: Product): Promise<R<string>> => {
    return post<R<string>>('/api/admin/product/save', params);
};

/**
 * 删除产品
 */
export const productDeleteApi = (params: DeleteParams): Promise<R<string>> => {
    return post<R<string>>('/api/admin/product/delete', params);
};
