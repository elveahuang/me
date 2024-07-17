import { Anonymous } from '@/commons/decorator/anonymous.decorator';
import { ProductEntity } from '@/modules/product/domain/entity/product.entity';
import { ProductService } from '@/modules/product/service/product.service';
import { Controller, Post } from '@nestjs/common';

@Controller('/api/product')
export class ProductAppController {
    constructor(private readonly productService: ProductService) {}

    @Anonymous()
    @Post('/list')
    async list(): Promise<ProductEntity[]> {
        return [];
    }
}
