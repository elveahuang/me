import { EntityService } from '@/commons/service/entity.service';
import { defaultPagination } from '@/commons/types';
import { generateLike } from '@/commons/utils';
import { ProductCheckDto } from '@/modules/product/domain/dto/product-check.dto';
import { ProductDetailsDto } from '@/modules/product/domain/dto/product-details.dto';
import { ProductListDto } from '@/modules/product/domain/dto/product-list.dto';
import { ProductSaveDto } from '@/modules/product/domain/dto/product-save.dto';
import { ProductEntity } from '@/modules/product/domain/entity/product.entity';
import { ProductRepository } from '@/modules/product/repository/product.repository';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isEmpty } from 'radash';
import { Brackets, Like, SelectQueryBuilder, WhereExpressionBuilder } from 'typeorm';

@Injectable()
export class ProductService extends EntityService<ProductEntity, ProductRepository> {
    constructor(@InjectRepository(ProductEntity) readonly productRepository: ProductRepository) {
        super(productRepository);
    }

    async checkCode(dto: ProductCheckDto): Promise<boolean> {
        const count: number = await this.getRepository().count({
            where: {
                code: dto.code,
            },
        });
        return count <= 0;
    }

    async search(pagination: ProductListDto = defaultPagination): Promise<[ProductEntity[], number]> {
        const { page, size } = pagination;
        const qb: SelectQueryBuilder<ProductEntity> = this.getRepository()
            .createQueryBuilder('p')
            .take(size)
            .skip((page - 1) * size)
            .where({
                active: true,
            });
        // 关键字模糊搜索
        if (!isEmpty(pagination.q)) {
            const q: string = generateLike(pagination.q);
            qb.andWhere(
                new Brackets((qb: WhereExpressionBuilder): void => {
                    qb.where({ code: Like(q) })
                        .orWhere({ title: Like(q) })
                        .orWhere({ content: Like(q) });
                }),
            );
        }
        return qb.getManyAndCount();
    }

    async saveProduct(dto: ProductSaveDto): Promise<void> {
        const entity: ProductEntity = new ProductEntity();
        entity.id = dto.id;
        entity.code = dto.code;
        entity.title = dto.title;
        entity.content = dto.content;
        await this.getRepository().save(entity);
    }

    toDetailsDto(entity: ProductEntity): ProductDetailsDto {
        return {
            id: entity.id,
            code: entity.code,
            title: entity.title,
            content: entity.content,
        };
    }
}
