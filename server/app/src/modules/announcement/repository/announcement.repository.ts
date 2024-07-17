import { AnnouncementEntity } from '@/modules/announcement/domain/entity/announcement.entity';
import { Repository } from 'typeorm';

export interface AnnouncementRepository extends Repository<AnnouncementEntity> {
    this: Repository<AnnouncementEntity>;
}

export const AnnouncementRepositoryImpl: Pick<AnnouncementEntity, any> = {};
