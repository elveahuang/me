import { AttachmentFileEntity } from '@/modules/attachment/domain/entity/attachment-file.entity';
import { AttachmentRelationEntity } from '@/modules/attachment/domain/entity/attachment-relation.entity';
import { AttachmentTypeEntity } from '@/modules/attachment/domain/entity/attachment-type.entity';
import { AttachmentFileRepository } from '@/modules/attachment/repository/attachment-file.repository';
import { AttachmentRelationRepository } from '@/modules/attachment/repository/attachment-relation.repository';
import { AttachmentTypeRepository } from '@/modules/attachment/repository/attachment-type.repository';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class AttachmentService {
    constructor(
        @InjectRepository(AttachmentFileEntity) private readonly attachmentFileRepository: AttachmentFileRepository,
        @InjectRepository(AttachmentRelationEntity) private readonly attachmentRelationRepository: AttachmentRelationRepository,
        @InjectRepository(AttachmentTypeEntity) private readonly attachmentTypeRepository: AttachmentTypeRepository,
    ) {}
}
