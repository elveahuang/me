import { Anonymous } from '@/commons/decorator/anonymous.decorator';
import { DeleteQuery, EntityKey, Page, R } from '@/commons/types';
import { toPage } from '@/commons/utils';
import { Web } from '@/commons/utils/web';
import { BaseController } from '@/commons/web/base.controller';
import { UserListDto } from '@/modules/core/domain/dto/user-list.dto';
import { ProductCheckDto } from '@/modules/product/domain/dto/product-check.dto';
import { ProductDetailsDto } from '@/modules/product/domain/dto/product-details.dto';
import { ProductSaveDto } from '@/modules/product/domain/dto/product-save.dto';
import { ProductEntity } from '@/modules/product/domain/entity/product.entity';
import { ProductService } from '@/modules/product/service/product.service';
import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';

@Controller('/api/admin/product')
export class ProductAdminController extends BaseController {
    constructor(private readonly productService: ProductService) {
        super();
    }

    @Anonymous()
    @Post('/check')
    async check(@Body() dto: ProductCheckDto): Promise<R<boolean>> {
        return Web.success(await this.productService.checkCode(dto));
    }

    @Anonymous()
    @ApiOperation({ summary: '用户列表' })
    @Post('/list')
    async list(@Body() pagination: UserListDto): Promise<R<Page<ProductDetailsDto>>> {
        const [items, total]: [ProductEntity[], number] = await this.productService.search(pagination);
        const page: Page<ProductDetailsDto> = toPage(
            items?.map((item: ProductEntity) => this.productService.toDetailsDto(item)),
            total,
            pagination,
        );
        return Web.page(page);
    }

    @Anonymous()
    @ApiOperation({ summary: '用户详情' })
    @Post('/details')
    async details(@Body('id') id: EntityKey): Promise<R<ProductDetailsDto>> {
        const entity: ProductEntity = await this.productService.findById(id);
        return Web.success(this.productService.toDetailsDto(entity));
    }

    @Anonymous()
    @Post('/save')
    async save(@Body() dto: ProductSaveDto): Promise<R> {
        this.productService.saveProduct(dto).then();
        return Web.success();
    }

    @Anonymous()
    @Post('/delete')
    async delete(@Body() dto: DeleteQuery): Promise<R> {
        this.productService.batchSoftDelete(dto).then();
        return Web.success();
    }
}
