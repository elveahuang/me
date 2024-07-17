import { EntityKey } from '@/commons/types';
import { RoleEntity } from '@/modules/core/domain/entity/role.entity';
import { UserRoleEntity } from '@/modules/core/domain/entity/user-role.entity';
import { Repository } from 'typeorm';

export interface RoleRepository extends Repository<RoleEntity> {
    this: Repository<RoleEntity>;

    findByUserId(userId: EntityKey): Promise<RoleEntity[]>;
}

export const RoleRepositoryImpl: Pick<RoleRepository, any> = {
    async findByUserId(this: Repository<RoleEntity>, userId: bigint): Promise<RoleEntity[]> {
        return this.createQueryBuilder('e').innerJoin(UserRoleEntity, 'r', 'r.roleId = e.id and r.userId = :userId', { userId: userId }).getMany();
    },
};
