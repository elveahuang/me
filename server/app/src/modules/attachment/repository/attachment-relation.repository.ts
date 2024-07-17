import { AttachmentRelationEntity } from '@/modules/attachment/domain/entity/attachment-relation.entity';
import { Repository } from 'typeorm';

export interface AttachmentRelationRepository extends Repository<AttachmentRelationEntity> {
    this: Repository<AttachmentRelationEntity>;
}

export const AttachmentRelationRepositoryImpl: Pick<AttachmentRelationEntity, any> = {};
