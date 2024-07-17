import { CommonsModule } from '@/commons/commons.module';
import { createCustomRepository } from '@/commons/utils';
import { AttachmentAdminController } from '@/modules/attachment/controller/attachment.admin.controller';
import { AttachmentAppController } from '@/modules/attachment/controller/attachment.app.controller';
import { AttachmentFileEntity } from '@/modules/attachment/domain/entity/attachment-file.entity';
import { AttachmentRelationEntity } from '@/modules/attachment/domain/entity/attachment-relation.entity';
import { AttachmentTypeEntity } from '@/modules/attachment/domain/entity/attachment-type.entity';
import { AttachmentFileRepositoryImpl } from '@/modules/attachment/repository/attachment-file.repository';
import { AttachmentRelationRepositoryImpl } from '@/modules/attachment/repository/attachment-relation.repository';
import { AttachmentTypeRepositoryImpl } from '@/modules/attachment/repository/attachment-type.repository';
import { AttachmentService } from '@/modules/attachment/service/attachment.service';
import { AuthModule } from '@/modules/auth/auth.module';
import { CoreModule } from '@/modules/core/core.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
    imports: [
        TypeOrmModule.forFeature([AttachmentFileEntity, AttachmentRelationEntity, AttachmentTypeEntity]),
        CommonsModule,
        CoreModule,
        AuthModule,
    ],
    providers: [
        createCustomRepository(AttachmentFileEntity, AttachmentFileRepositoryImpl),
        createCustomRepository(AttachmentRelationEntity, AttachmentRelationRepositoryImpl),
        createCustomRepository(AttachmentTypeEntity, AttachmentTypeRepositoryImpl),
        AttachmentService,
    ],
    controllers: [AttachmentAdminController, AttachmentAppController],
    exports: [AttachmentService],
})
export class AttachmentModule {}
