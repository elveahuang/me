import { LangEntity } from '@/modules/core/domain/entity/lang.entity';
import { Repository } from 'typeorm';

export interface LangRepository extends Repository<LangEntity> {
    this: Repository<LangEntity>;
}

export const LangRepositoryImpl: Pick<LangRepository, any> = {};
