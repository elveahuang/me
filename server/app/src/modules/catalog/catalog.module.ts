import { CommonsModule } from '@/commons/commons.module';
import { createCustomRepository } from '@/commons/utils';
import { AuthModule } from '@/modules/auth/auth.module';
import { CatalogAdminController } from '@/modules/catalog/controller/catalog.admin.controller';
import { CatalogAppController } from '@/modules/catalog/controller/catalog.app.controller';
import { CatalogRelationEntity } from '@/modules/catalog/entity/catalog-relation.entity';
import { CatalogTypeEntity } from '@/modules/catalog/entity/catalog-type.entity';
import { CatalogEntity } from '@/modules/catalog/entity/catalog.entity';
import { CatalogRelationRepositoryImpl } from '@/modules/catalog/repository/catalog-relation.repository';
import { CatalogTypeRepositoryImpl } from '@/modules/catalog/repository/catalog-type.repository';
import { CatalogRepositoryImpl } from '@/modules/catalog/repository/catalog.repository';
import { CatalogService } from '@/modules/catalog/service/catalog.service';
import { CoreModule } from '@/modules/core/core.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
    imports: [TypeOrmModule.forFeature([CatalogEntity, CatalogRelationEntity, CatalogTypeEntity]), CommonsModule, CoreModule, AuthModule],
    providers: [
        createCustomRepository(CatalogEntity, CatalogRepositoryImpl),
        createCustomRepository(CatalogRelationEntity, CatalogRelationRepositoryImpl),
        createCustomRepository(CatalogTypeEntity, CatalogTypeRepositoryImpl),
        CatalogService,
    ],
    controllers: [CatalogAdminController, CatalogAppController],
    exports: [CatalogService],
})
export class CatalogModule {}
