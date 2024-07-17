import { EntityService } from '@/commons/service/entity.service';
import { EntityKey } from '@/commons/types';
import { RoleSaveDto } from '@/modules/core/domain/dto/role-save.dto';
import { RoleEntity } from '@/modules/core/domain/entity/role.entity';
import { RoleRepository } from '@/modules/core/repository/role.repository';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class RoleService extends EntityService<RoleEntity, RoleRepository> {
    constructor(@InjectRepository(RoleEntity) readonly roleRepository: RoleRepository) {
        super(roleRepository);
    }

    async saveRole(dto: RoleSaveDto): Promise<void> {
        const entity: RoleEntity = new RoleEntity();
        entity.id = dto.id;
        await this.getRepository().save(entity);
    }

    async findByUserId(userId: EntityKey): Promise<RoleEntity[]> {
        return await this.roleRepository.findByUserId(userId);
    }
}
