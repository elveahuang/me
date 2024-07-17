import { UserEntity } from '@/modules/core/domain/entity/user.entity';
import { Repository } from 'typeorm';

export interface UserRepository extends Repository<UserEntity> {
    this: Repository<UserEntity>;

    /**
     * 根据用户名查找用户
     */
    findByUsername(username: string): Promise<UserEntity>;
}

export const UserRepositoryImpl: Pick<UserRepository, any> = {
    async findByUsername(this: Repository<UserEntity>, username: string): Promise<UserEntity> {
        return this.createQueryBuilder('u').where('u.username = :username', { username: username }).getOne();
    },
};
