import { EntityService } from '@/commons/service/entity.service';
import { ConfigEntity } from '@/modules/core/domain/entity/config.entity';
import { ConfigRepository } from '@/modules/core/repository/config.repository';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class ConfigService extends EntityService<ConfigEntity, ConfigRepository> {
    constructor(@InjectRepository(ConfigEntity) readonly configRepository: ConfigRepository) {
        super(configRepository);
    }
}
