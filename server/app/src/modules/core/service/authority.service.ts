import { EntityService } from '@/commons/service/entity.service';
import { EntityKey } from '@/commons/types';
import { AuthoritySaveDto } from '@/modules/core/domain/dto/authority-save.dto';
import { AuthorityEntity } from '@/modules/core/domain/entity/authority.entity';
import { AuthorityRepository } from '@/modules/core/repository/authority.repository';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class AuthorityService extends EntityService<AuthorityEntity, AuthorityRepository> {
    constructor(@InjectRepository(AuthorityEntity) readonly authorityRepository: AuthorityRepository) {
        super(authorityRepository);
    }

    async saveAuthority(dto: AuthoritySaveDto): Promise<void> {
        const entity: AuthorityEntity = new AuthorityEntity();
        entity.id = dto.id;
        await this.getRepository().save(entity);
    }

    async findByUserId(userId: EntityKey): Promise<AuthorityEntity[]> {
        return await this.authorityRepository.findByUserId(userId);
    }
}
