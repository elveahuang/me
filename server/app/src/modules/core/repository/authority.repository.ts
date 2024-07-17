import { EntityKey } from '@/commons/types';
import { AuthorityEntity } from '@/modules/core/domain/entity/authority.entity';
import { RoleAuthorityEntity } from '@/modules/core/domain/entity/role-authority.entity';
import { UserRoleEntity } from '@/modules/core/domain/entity/user-role.entity';
import { Repository } from 'typeorm';

export interface AuthorityRepository extends Repository<AuthorityEntity> {
    this: Repository<AuthorityEntity>;

    findByUserId(userId: EntityKey): Promise<AuthorityEntity[]>;
}

export const AuthorityRepositoryImpl: Pick<AuthorityRepository, any> = {
    async findByUserId(this: Repository<AuthorityEntity>, userId: bigint): Promise<AuthorityEntity[]> {
        return this.createQueryBuilder('a')
            .innerJoin(RoleAuthorityEntity, 'ra', 'ra.authorityId = a.id')
            .innerJoin(UserRoleEntity, 'ur', 'ur.roleId = ra.roleId and ur.userId = :userId', { userId: userId })
            .getMany();
    },
};
