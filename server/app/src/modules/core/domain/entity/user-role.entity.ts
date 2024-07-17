import { SimpleEntity } from '@/commons/entity/simple.entity';
import { Column, Entity } from 'typeorm';

@Entity('sys_user_role')
export class UserRoleEntity extends SimpleEntity {
    @Column({ type: 'bigint', name: 'user_id', comment: '用户ID' })
    userId: bigint;

    @Column({ type: 'bigint', name: 'role_id', comment: '角色ID' })
    roleId: bigint;
}
