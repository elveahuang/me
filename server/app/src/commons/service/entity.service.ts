import { IdEntity } from '@/commons/entity/id.entity';
import { ServiceException } from '@/commons/exception/service.exception';
import { BaseService } from '@/commons/service/base.service';
import { defaultPagination, DeleteQuery, EntityKey, Page, Pagination } from '@/commons/types';
import { toPage } from '@/commons/utils';
import { FindOptionsWhere, Repository } from 'typeorm';
import { FindManyOptions } from 'typeorm/find-options/FindManyOptions';

export abstract class EntityService<T extends IdEntity, R extends Repository<T>> extends BaseService {
    protected constructor(private readonly repository: R) {
        super();
    }

    getRepository(): R {
        return this.repository;
    }

    async searchByPage(pagination: Pagination = defaultPagination, options: FindManyOptions<T> = {}): Promise<[T[], number]> {
        const { page, size } = pagination;
        return await this.getRepository().findAndCount({
            skip: (page - 1) * size,
            take: size,
            ...options,
        });
    }

    async findByPage(request: Pagination = defaultPagination): Promise<Page<T>> {
        const { page, size } = request;
        const result: [T[], number] = await this.getRepository().findAndCount({
            skip: (page - 1) * size,
            take: size,
        });
        return toPage(result[0], result[1], request);
    }

    async findById(id: EntityKey): Promise<T> {
        const options: FindOptionsWhere<T> = {
            id: id || '0',
        } as FindOptionsWhere<T>;
        const entity: T = await this.getRepository().findOneBy(options);
        if (!entity) {
            throw new ServiceException();
        }
        return entity;
    }

    async deleteById(id: EntityKey): Promise<void> {
        await this.getRepository().delete({
            id: id,
        } as FindOptionsWhere<T>);
    }

    async softDeleteById(id: EntityKey): Promise<void> {
        await this.getRepository().softDelete({
            id: id,
        } as FindOptionsWhere<T>);
    }

    /**
     * 批量软删除
     */
    async batchSoftDelete(query: DeleteQuery): Promise<void> {
        if (query?.ids?.length > 0) {
            this.repository.createQueryBuilder().whereInIds(query.ids).softDelete();
        }
    }
}
