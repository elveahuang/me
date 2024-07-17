import { EntityService } from '@/commons/service/entity.service';
import { AnnouncementSaveDto } from '@/modules/announcement/domain/dto/announcement-save.dto';
import { AnnouncementEntity } from '@/modules/announcement/domain/entity/announcement.entity';
import { AnnouncementRepository } from '@/modules/announcement/repository/announcement.repository';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class AnnouncementService extends EntityService<AnnouncementEntity, AnnouncementRepository> {
    constructor(@InjectRepository(AnnouncementEntity) private readonly announcementRepository: AnnouncementRepository) {
        super(announcementRepository);
    }

    async saveAnnouncement(dto: AnnouncementSaveDto): Promise<void> {
        const entity: AnnouncementEntity = new AnnouncementEntity();
        entity.id = dto.id;
        entity.title = dto.title;
        entity.content = dto.content;
        await this.announcementRepository.save(entity);
    }
}
