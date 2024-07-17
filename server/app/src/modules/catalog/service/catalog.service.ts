import { CatalogRelationEntity } from '@/modules/catalog/entity/catalog-relation.entity';
import { CatalogTypeEntity } from '@/modules/catalog/entity/catalog-type.entity';
import { CatalogEntity } from '@/modules/catalog/entity/catalog.entity';
import { CatalogRelationRepository } from '@/modules/catalog/repository/catalog-relation.repository';
import { CatalogTypeRepository } from '@/modules/catalog/repository/catalog-type.repository';
import { CatalogRepository } from '@/modules/catalog/repository/catalog.repository';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class CatalogService {
    constructor(
        @InjectRepository(CatalogEntity) private readonly catalogRepository: CatalogRepository,
        @InjectRepository(CatalogRelationEntity) private readonly catalogRelationRepository: CatalogRelationRepository,
        @InjectRepository(CatalogTypeEntity) private readonly catalogTypeRepository: CatalogTypeRepository,
    ) {}
}
