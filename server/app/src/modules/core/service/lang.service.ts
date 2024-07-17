import { EntityService } from '@/commons/service/entity.service';
import { LangEntity } from '@/modules/core/domain/entity/lang.entity';
import { LangRepository } from '@/modules/core/repository/lang.repository';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class LangService extends EntityService<LangEntity, LangRepository> {
    constructor(@InjectRepository(LangEntity) readonly langRepository: LangRepository) {
        super(langRepository);
    }
}
