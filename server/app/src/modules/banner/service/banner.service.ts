import { EntityService } from '@/commons/service/entity.service';
import { BannerSaveDto } from '@/modules/banner/domain/dto/banner-save.dto';
import { BannerEntity } from '@/modules/banner/domain/entity/banner.entity';
import { BannerRepository } from '@/modules/banner/repository/banner.repository';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class BannerService extends EntityService<BannerEntity, BannerRepository> {
    constructor(@InjectRepository(BannerEntity) readonly bannerRepository: BannerRepository) {
        super(bannerRepository);
    }

    async saveBanner(dto: BannerSaveDto): Promise<void> {
        const entity: BannerEntity = new BannerEntity();
        entity.id = dto.id;
        entity.title = dto.title;
        await this.getRepository().save(entity);
    }
}
