import { SimpleEntity } from '@/commons/entity/simple.entity';
import { Column, Entity } from 'typeorm';

@Entity('sys_role_authority')
export class RoleAuthorityEntity extends SimpleEntity {
    @Column({ type: 'bigint', name: 'authority_id', comment: '权限ID' })
    authorityId: bigint;

    @Column({ type: 'bigint', name: 'role_id', comment: '角色ID' })
    roleId: bigint;
}
