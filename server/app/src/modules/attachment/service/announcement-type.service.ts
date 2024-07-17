import { EntityService } from '@/commons/service/entity.service';
import { AttachmentTypeEntity } from '@/modules/attachment/domain/entity/attachment-type.entity';
import { AttachmentTypeRepository } from '@/modules/attachment/repository/attachment-type.repository';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class AnnouncementTypeService extends EntityService<AttachmentTypeEntity, AttachmentTypeRepository> {
    constructor(@InjectRepository(AttachmentTypeEntity) readonly attachmentTypeRepository: AttachmentTypeRepository) {
        super(attachmentTypeRepository);
    }
}
