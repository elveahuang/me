import { EntityService } from '@/commons/service/entity.service';
import { AttachmentRelationEntity } from '@/modules/attachment/domain/entity/attachment-relation.entity';
import { AttachmentRelationRepository } from '@/modules/attachment/repository/attachment-relation.repository';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class AnnouncementRelationService extends EntityService<AttachmentRelationEntity, AttachmentRelationRepository> {
    constructor(@InjectRepository(AttachmentRelationEntity) readonly attachmentRelationRepository: AttachmentRelationRepository) {
        super(attachmentRelationRepository);
    }
}
