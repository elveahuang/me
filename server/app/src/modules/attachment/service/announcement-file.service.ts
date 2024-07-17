import { EntityService } from '@/commons/service/entity.service';
import { AttachmentFileEntity } from '@/modules/attachment/domain/entity/attachment-file.entity';
import { AttachmentFileRepository } from '@/modules/attachment/repository/attachment-file.repository';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class AnnouncementFileService extends EntityService<AttachmentFileEntity, AttachmentFileRepository> {
    constructor(@InjectRepository(AttachmentFileEntity) readonly attachmentFileRepository: AttachmentFileRepository) {
        super(attachmentFileRepository);
    }
}
