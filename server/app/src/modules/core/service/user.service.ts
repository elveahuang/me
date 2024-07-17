import { EntityService } from '@/commons/service/entity.service';
import { defaultPagination } from '@/commons/types';
import { generateLike } from '@/commons/utils';
import { UserCheckDto } from '@/modules/core/domain/dto/user-check.dto';
import { UserDetailsDto } from '@/modules/core/domain/dto/user-details.dto';
import { UserListDto } from '@/modules/core/domain/dto/user-list.dto';
import { UserRegisterDto } from '@/modules/core/domain/dto/user-register.dto';
import { UserSaveDto } from '@/modules/core/domain/dto/user-save.dto';
import { AuthorityEntity } from '@/modules/core/domain/entity/authority.entity';
import { RoleEntity } from '@/modules/core/domain/entity/role.entity';
import { UserEntity } from '@/modules/core/domain/entity/user.entity';
import { AuthorityRepository } from '@/modules/core/repository/authority.repository';
import { RoleRepository } from '@/modules/core/repository/role.repository';
import { UserRepository } from '@/modules/core/repository/user.repository';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isEmpty } from 'radash';
import { Brackets, Like, SelectQueryBuilder, WhereExpressionBuilder } from 'typeorm';

@Injectable()
export class UserService extends EntityService<UserEntity, UserRepository> {
    constructor(
        @InjectRepository(UserEntity) readonly userRepository: UserRepository,
        @InjectRepository(RoleEntity) readonly roleRepository: RoleRepository,
        @InjectRepository(AuthorityEntity) readonly authorityRepository: AuthorityRepository,
    ) {
        super(userRepository);
    }

    async checkUsername(dto: UserCheckDto): Promise<boolean> {
        const count: number = await this.getRepository().count({
            where: {
                username: dto.username,
            },
        });
        return count <= 0;
    }

    async search(pagination: UserListDto = defaultPagination): Promise<[UserEntity[], number]> {
        const { page, size } = pagination;
        const qb: SelectQueryBuilder<UserEntity> = this.getRepository()
            .createQueryBuilder('u')
            .take(size)
            .skip((page - 1) * size)
            .where({
                active: true,
            });
        // 关键字模糊搜索
        if (!isEmpty(pagination.q)) {
            const q: string = generateLike(pagination.q);
            qb.andWhere(
                new Brackets((qb: WhereExpressionBuilder): void => {
                    qb.where({ username: Like(q) })
                        .orWhere({ displayName: Like(q) })
                        .orWhere({ name: Like(q) });
                }),
            );
        }
        return qb.getManyAndCount();
    }

    async register(dto: UserRegisterDto): Promise<void> {}

    async findByUsername(username: string): Promise<UserEntity> {
        return await this.userRepository.findByUsername(username);
    }

    async saveUser(dto: UserSaveDto): Promise<void> {
        const entity: UserEntity = new UserEntity();
        entity.id = dto.id;
        entity.username = dto.username;
        entity.password = dto.password;
        await this.getRepository().save(entity);
    }

    toDetailsDto(entity: UserEntity): UserDetailsDto {
        return {
            id: entity.id,
            username: entity.username,
            displayName: entity.displayName,
            name: entity.name,
            status: entity.status,
        };
    }
}
