import { defaultJoiValidationOptions } from '@/commons/constants';
import { ValidationException } from '@/commons/exception/validation-exception';
import { Page, Pagination } from '@/commons/types';
import { ValidationItem } from '@/commons/types/validation';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { SchemaLike, ValidationErrorItem, ValidationOptions, ValidationResult } from 'joi';
import { merge } from 'lodash';
import { isEmpty } from 'radash';
import { DataSource } from 'typeorm';
import { v4 } from 'uuid';

/**
 * UUID
 */
export const uuid = (): string => {
    return v4();
};

/**
 * 输出日志
 */
export function log(log: any): void {
    console.log(log);
}

/**
 * 构建自定义的仓库类
 * @param entity 实体类
 * @param repository 自定义实现类
 */
export const createCustomRepository = (entity: any, repository: any) => {
    return {
        provide: getRepositoryToken(entity),
        inject: [getDataSourceToken()],
        useFactory(datasource: DataSource) {
            return datasource.getRepository(entity).extend(repository);
        },
    };
};

export const toPage = <T>(data: T[], total: number, request: Pagination): Page<T> => {
    return {
        content: data,
        totalElements: total,
        pageable: {
            pageNumber: request.page,
            pageSize: request.size,
        },
    };
};

export const generateLike = (value: string): string => {
    return isEmpty(value) ? '%%' : `%${value}%`;
};

export const validate = <T>(value: T, schema: SchemaLike, options: ValidationOptions = {}): ValidationResult<T> => {
    const result: ValidationResult<T> = validate<T>(value, schema, merge(defaultJoiValidationOptions, options));
    if (!isEmpty(result.error)) {
        console.log(result.error);
        const errors: Array<ValidationItem> = [];
        result.error.details.forEach((e: ValidationErrorItem): void => {
            const error: ValidationItem = {
                key: e.context.key,
                label: e.context.label,
                value: result.value[e.context.key],
                message: e.message,
            };
            errors.push(error);
        });
        throw new ValidationException(errors);
    }
    return result;
};
