import { RoleAuthorityEntity } from '@/modules/core/domain/entity/role-authority.entity';
import { Repository } from 'typeorm';

export interface RoleAuthorityRepository extends Repository<RoleAuthorityEntity> {
    this: Repository<RoleAuthorityEntity>;
}

export const RoleAuthorityRepositoryImpl: Pick<RoleAuthorityRepository, any> = {};
