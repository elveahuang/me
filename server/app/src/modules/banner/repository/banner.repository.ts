import { BannerEntity } from '@/modules/banner/domain/entity/banner.entity';
import { Repository } from 'typeorm';

export interface BannerRepository extends Repository<BannerEntity> {
    this: Repository<BannerEntity>;
}

export const BannerRepositoryImpl: Pick<BannerEntity, any> = {};
