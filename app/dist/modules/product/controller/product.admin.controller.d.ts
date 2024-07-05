import { DeleteQuery, EntityKey, Page, R } from '@/commons/types';
import { BaseController } from '@/commons/web/base.controller';
import { UserListDto } from '@/modules/core/domain/dto/user-list.dto';
import { ProductCheckDto } from '@/modules/product/domain/dto/product-check.dto';
import { ProductDetailsDto } from '@/modules/product/domain/dto/product-details.dto';
import { ProductSaveDto } from '@/modules/product/domain/dto/product-save.dto';
import { ProductService } from '@/modules/product/service/product.service';
export declare class ProductAdminController extends BaseController {
    private readonly productService;
    constructor(productService: ProductService);
    check(dto: ProductCheckDto): Promise<R<boolean>>;
    list(pagination: UserListDto): Promise<R<Page<ProductDetailsDto>>>;
    details(id: EntityKey): Promise<R<ProductDetailsDto>>;
    save(dto: ProductSaveDto): Promise<R>;
    delete(dto: DeleteQuery): Promise<R>;
}
