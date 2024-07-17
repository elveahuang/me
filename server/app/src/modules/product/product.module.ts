import { CommonsModule } from '@/commons/commons.module';
import { createCustomRepository } from '@/commons/utils';
import { AuthModule } from '@/modules/auth/auth.module';
import { CoreModule } from '@/modules/core/core.module';
import { ProductAdminController } from '@/modules/product/controller/product.admin.controller';
import { ProductAppController } from '@/modules/product/controller/product.app.controller';
import { ProductEntity } from '@/modules/product/domain/entity/product.entity';
import { ProductRepositoryImpl } from '@/modules/product/repository/product.repository';
import { ProductService } from '@/modules/product/service/product.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
    imports: [TypeOrmModule.forFeature([ProductEntity]), CommonsModule, CoreModule, AuthModule],
    providers: [createCustomRepository(ProductEntity, ProductRepositoryImpl), ProductService],
    controllers: [ProductAdminController, ProductAppController],
    exports: [ProductService],
})
export class ProductModule {}
