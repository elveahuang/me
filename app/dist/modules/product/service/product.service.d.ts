import { EntityService } from '@/commons/service/entity.service';
import { ProductCheckDto } from '@/modules/product/domain/dto/product-check.dto';
import { ProductDetailsDto } from '@/modules/product/domain/dto/product-details.dto';
import { ProductListDto } from '@/modules/product/domain/dto/product-list.dto';
import { ProductSaveDto } from '@/modules/product/domain/dto/product-save.dto';
import { ProductEntity } from '@/modules/product/domain/entity/product.entity';
import { ProductRepository } from '@/modules/product/repository/product.repository';
export declare class ProductService extends EntityService<ProductEntity, ProductRepository> {
    readonly productRepository: ProductRepository;
    constructor(productRepository: ProductRepository);
    checkCode(dto: ProductCheckDto): Promise<boolean>;
    search(pagination?: ProductListDto): Promise<[ProductEntity[], number]>;
    saveProduct(dto: ProductSaveDto): Promise<void>;
    toDetailsDto(entity: ProductEntity): ProductDetailsDto;
}
